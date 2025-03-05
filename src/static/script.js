document.addEventListener("DOMContentLoaded", function () {
  const logsDiv = document.getElementById("logs");
  const form = document.querySelector("form");
  const pathInput = document.getElementById("path");
  const pathInputSuggestions = document.getElementById(
    "path-input-suggestions"
  );
  const processed = document.getElementById("processed-count");
  const pictures = document.getElementById("pictures-count");
  const videos = document.getElementById("videos-count");
  const errors = document.getElementById("errors-count");
  const errorMessage = document.getElementById("error-message");
  let ws;
  let typingTimer;
  const typingDelay = 300;

  function connectWebSocket() {
    ws = new WebSocket(`ws://${window.location.host}/ws/reorganizer`);
    ws.onopen = function () {
      console.log("WebSocket connected");
    };
    ws.onmessage = function (event) {
      console.log("WebSocket message received:", event.data);
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
        disableSubmit(false);
      } else if (event.data.includes("event-busy:true")) {
        disableSubmit(true);
      } else {
        logsDiv.innerHTML += `${event.data}\n`;
        logsDiv.scrollTop = logsDiv.scrollHeight;
      }
    };
    ws.onclose = () => {
      console.log("WebSocket closed. Reconnecting...");
      setTimeout(connectWebSocket, 1000); // Intenta reconectar tras 1 segundo
    };
  }

  function handlePathInput(event) {
    clearTimeout(typingTimer);
    const path = event.target.value;
    typingTimer = setTimeout(() => {
      fetch(
        `${window.location.protocol}dirs?subfolder=${encodeURIComponent(path)}`
      )
        .then((response) => response.json())
        .then((data) => {
          pathInputSuggestions.innerHTML = "";
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
            errorMessage.textContent = "";
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
          pathInputSuggestions.appendChild(ul);
        })
        .catch((error) => {
          console.error("Error fetching subfolder data:", error);
        });
    }, typingDelay);
  }

  pathInput.addEventListener("input", handlePathInput);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const path = document.getElementById("path").value;

    if (!path.trim()) {
      errorMessage.textContent = "Output path cannot be empty.";
      return;
    } else {
      errorMessage.textContent = "";
    }

    logsDiv.innerHTML = "";
    processed.textContent = 0;
    pictures.textContent = 0;
    videos.textContent = 0;
    errors.textContent = 0;
    updateTotal(0);

    ws.send(JSON.stringify({ path: path }));
  });

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
