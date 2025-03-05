document.addEventListener("DOMContentLoaded", function () {
  const inputFiles = document.getElementById("input-files");
  const inputPreview = document.getElementById("input-preview");
  let lastActive;
  const inputPreviewVideo = document.getElementById("input-preview-video");
  const pictureExtensions = ["jpg", "jpeg", "png", "gif", "bmp", "tiff"];
  const videoExtensions = ["mp4", "avi", "mov", "mkv", "flv", "wmv"];
  const logsDiv = document.getElementById("logs");
  const submitBtn = document.getElementById("submit-btn");
  const pathInput = document.getElementById("path");
  const inputFieldLabel = document.getElementById("input-field-label");
  const pathOutputSuggestions = document.getElementById("output-suggestions");
  const processed = document.getElementById("processed-count");
  const pictures = document.getElementById("pictures-count");
  const videos = document.getElementById("videos-count");
  const errors = document.getElementById("errors-count");
  let ws;
  let typingTimer;
  const typingDelay = 300;

  function fetchInputFiles() {
    fetch(`${window.location.protocol}input`)
      .then((response) => response.json())
      .then((data) => {
        inputFiles.innerHTML = "";
        const ul = document.createElement("ul");
        data.forEach((file) => {
          const li = document.createElement("li");
          li.classList.add("file");
          li.textContent = file;

          // Detect file type based on extension
          const ext = file.split(".").pop().toLowerCase();
          if (pictureExtensions.includes(ext)) {
            li.classList.add("image-file");
          } else if (videoExtensions.includes(ext)) {
            li.classList.add("video-file");
          } else {
            li.classList.add("unknown-file");
          }
          ul.appendChild(li);
        });
        ul.addEventListener("click", function (event) {
          const ext = event.target.textContent.split(".").pop().toLowerCase();
          if (lastActive) {
            lastActive.classList.remove("input-active");
          }
          event.target.classList.add("input-active");
          lastActive = event.target;
          if (pictureExtensions.includes(ext)) {
            inputPreview.src = `${window.location.protocol}input/${event.target.textContent}`;
            inputPreviewVideo.classList.add("hidden");
            inputPreviewVideo.pause();
            inputPreview.classList.remove("hidden");
          } else if (videoExtensions.includes(ext)) {
            inputPreviewVideo.src = `${window.location.protocol}input/${event.target.textContent}`;
            inputPreview.classList.add("hidden");
            inputPreviewVideo.classList.remove("hidden");
          } else {
            inputPreview.classList.add("hidden");
            inputPreviewVideo.classList.add("hidden");
            inputPreviewVideo.pause();
          }
        });
        inputFiles.appendChild(ul);
      })
      .catch((error) => {
        console.error("Error fetching input files:", error);
      });
  }

  function connectWebSocket() {
    ws = new WebSocket(`ws://${window.location.host}/ws/reorganizer`);
    ws.onopen = function () {
      console.log("WebSocket connected");
    };
    ws.onmessage = function (event) {
      if (event.data.includes("event-total:")) {
        updateTotal(event.data.replace("event-total:", ""));
      } else if (event.data.includes("event-processed:")) {
        updateProcessed();
        logsDiv.innerHTML += `${event.data.replace(
          "event-processed:",
          ""
        )}\n\n`;
        logsDiv.scrollTop = logsDiv.scrollHeight;
      } else if (event.data.includes("event-processed-pictures:")) {
        updateProcessedPictures();
      } else if (event.data.includes("event-processed-videos:")) {
        updateProcessedVideos();
      } else if (event.data.includes("event-error:")) {
        updateErrors();
        logsDiv.innerHTML += `${event.data.replace("event-error:", "")}\n\n`;
        logsDiv.scrollTop = logsDiv.scrollHeight;
      } else if (
        event.data.includes("event-complete") ||
        event.data.includes("event-busy:false")
      ) {
        inputPreview.src = "";
        inputPreviewVideo.src = "";
        inputPreviewVideo.pause();
        disableSubmit(false);
      } else if (event.data.includes("event-busy:true")) {
        disableSubmit(true);
      } else {
        logsDiv.innerHTML += `${event.data}\n`;
        logsDiv.scrollTop = logsDiv.scrollHeight;
      }
      fetchInputFiles();
    };
    ws.onclose = () => {
      console.log("WebSocket closed. Reconnecting...");
      setTimeout(connectWebSocket, 1000); // Intenta reconectar tras 1 segundo
    };
  }

  function handleOutputSuggestions(event) {
    pathInput.classList.remove("error");
    inputFieldLabel.textContent = "Output path";
    clearTimeout(typingTimer);
    const path = event.target.value;
    typingTimer = setTimeout(() => {
      fetch(
        `${window.location.protocol}output?subfolder=${encodeURIComponent(
          path
        )}`
      )
        .then((response) => response.json())
        .then((data) => {
          pathOutputSuggestions.innerHTML = "";
          const ul = document.createElement("ul");
          ul.classList.add("tree");
          if (pathInput.value) {
            const li = document.createElement("li");
            li.classList.add("folder");
            li.textContent = "..";
            ul.appendChild(li);
          }
          data.forEach((dir) => {
            const li = document.createElement("li");
            li.classList.add("folder");
            li.textContent = dir;
            ul.appendChild(li);
          });
          ul.addEventListener("click", function (event) {
            pathInput.focus();
            if (event.target.textContent === "..") {
              pathInput.value =
                pathInput.value.split("/").slice(0, -2).join("/") + "/";
              if (pathInput.value === "/") {
                pathInput.value = "";
              }
              pathInput.dispatchEvent(new Event("input"));
              return;
            }
            if (!pathInput.value.endsWith("/") && pathInput.value !== "") {
              pathInput.value += "/";
            }
            pathInput.value += event.target.textContent + "/";
            pathInput.dispatchEvent(new Event("input"));
          });
          pathOutputSuggestions.appendChild(ul);
        })
        .catch((error) => {
          console.error("Error fetching subfolder data:", error);
        });
    }, typingDelay);
  }

  pathInput.addEventListener("input", handleOutputSuggestions);
  pathInput.addEventListener("focus", () => {
    pathInput.classList.remove("error");
    inputFieldLabel.textContent = "Output path";
  });

  submitBtn.addEventListener("click", function (event) {
    event.preventDefault();
    const path = document.getElementById("path").value;
    if (!path.trim()) {
      pathInput.classList.add("error");
      inputFieldLabel.textContent = "Output path cannot be empty";
      return;
    } else {
      pathInput.classList.remove("error");
      inputFieldLabel.textContent = "Output path";
    }

    logsDiv.innerHTML = "";
    processed.textContent = 0;
    pictures.textContent = 0;
    videos.textContent = 0;
    errors.textContent = 0;
    updateTotal(0);

    ws.send(JSON.stringify({ path: path }));
  });

  fetchInputFiles();
  connectWebSocket();
  pathInput.dispatchEvent(new Event("input"));
});

const disableSubmit = (disable) => {
  document.querySelector("button[type='submit']").disabled = disable;
};

function updateTotal(total) {
  document.getElementById("total-files").textContent = total;
}
function updateProcessed() {
  document.getElementById("processed-count").textContent =
    Number(document.getElementById("processed-count").textContent) + 1;
}
function updateProcessedPictures() {
  document.getElementById("pictures-count").textContent =
    Number(document.getElementById("pictures-count").textContent) + 1;
}
function updateProcessedVideos() {
  document.getElementById("videos-count").textContent =
    Number(document.getElementById("videos-count").textContent) + 1;
}
function updateErrors() {
  document.getElementById("errors-count").textContent =
    Number(document.getElementById("errors-count").textContent) + 1;
}
