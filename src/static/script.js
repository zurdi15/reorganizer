document.addEventListener("DOMContentLoaded", function () {
  const inputFiles = document.getElementById("input-files");
  const floatingPreview = document.getElementById("floating-preview");
  const floatingPreviewImg = document.getElementById("floating-preview-img");
  const floatingPreviewVideo = document.getElementById("floating-preview-video");
  let lastActive;
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
  let hideTimer; // Add timer for hiding preview
  const typingDelay = 300;
  const hideDelay = 100; // Small delay before hiding to prevent flickering

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
          
          // Add hover event listeners for preview directly to each list item
          li.addEventListener("mouseenter", function (event) {
            clearTimeout(hideTimer); // Cancel any pending hide
            showFloatingPreview(event.target, event);
          });
          
          li.addEventListener("mouseleave", function (event) {
            hideTimer = setTimeout(() => {
              hideFloatingPreview();
            }, hideDelay);
          });
          
          li.addEventListener("mousemove", function (event) {
            if (!floatingPreview.classList.contains("hidden")) {
              updateFloatingPreviewPosition(event);
            }
          });
          
          // Keep click functionality for active selection
          li.addEventListener("click", function (event) {
            if (lastActive) {
              lastActive.classList.remove("input-active");
            }
            event.target.classList.add("input-active");
            lastActive = event.target;
          });
          
          ul.appendChild(li);
        });
        
        inputFiles.appendChild(ul);
      })
      .catch((error) => {
        console.error("Error fetching input files:", error);
      });
  }

  function showFloatingPreview(fileElement, event) {
    const filename = fileElement.textContent;
    const ext = filename.split(".").pop().toLowerCase();
    
    console.log("Showing preview for:", filename, "Extension:", ext); // Debug log
    
    if (pictureExtensions.includes(ext)) {
      floatingPreviewImg.src = `${window.location.protocol}//${window.location.host}/input/${filename}`;
      floatingPreviewVideo.classList.add("hidden");
      floatingPreviewVideo.pause();
      floatingPreviewVideo.src = "";
      floatingPreviewImg.classList.remove("hidden");
      floatingPreview.classList.remove("hidden");
      console.log("Showing image preview"); // Debug log
    } else if (videoExtensions.includes(ext)) {
      floatingPreviewVideo.src = `${window.location.protocol}//${window.location.host}/input/${filename}`;
      floatingPreviewImg.classList.add("hidden");
      floatingPreviewImg.src = "";
      floatingPreviewVideo.classList.remove("hidden");
      floatingPreview.classList.remove("hidden");
      // Ensure video plays when shown
      floatingPreviewVideo.play().catch(e => console.log("Video play failed:", e));
      console.log("Showing video preview"); // Debug log
    } else {
      console.log("Unknown file type, not showing preview"); // Debug log
      return;
    }
    
    updateFloatingPreviewPosition(event);
  }

  function hideFloatingPreview() {
    console.log("Hiding floating preview"); // Debug log
    clearTimeout(hideTimer); // Clear any pending hide timer
    floatingPreview.classList.add("hidden");
    floatingPreviewImg.classList.add("hidden");
    floatingPreviewVideo.classList.add("hidden");
    floatingPreviewVideo.pause();
    floatingPreviewImg.src = "";
    floatingPreviewVideo.src = "";
  }

  function updateFloatingPreviewPosition(event) {
    const x = event.clientX;
    const y = event.clientY;
    const margin = 20;
    
    // Initially position the preview to the right of the cursor
    floatingPreview.style.left = (x + margin) + "px";
    floatingPreview.style.top = (y - 50) + "px"; // Start slightly above cursor
    
    // Force a layout update to get accurate dimensions
    floatingPreview.offsetHeight;
    
    // Get the actual dimensions after positioning
    const rect = floatingPreview.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Adjust horizontal position if it would go off-screen
    if (rect.right > viewportWidth - margin) {
      floatingPreview.style.left = (x - rect.width - margin) + "px";
    }
    
    // Adjust vertical position if it would go off-screen
    if (rect.bottom > viewportHeight - margin) {
      floatingPreview.style.top = (viewportHeight - rect.height - margin) + "px";
    }
    
    // Ensure it doesn't go above the top of the screen
    if (rect.top < margin) {
      floatingPreview.style.top = margin + "px";
    }
    
    // For very tall images, center them vertically if they still don't fit
    const finalRect = floatingPreview.getBoundingClientRect();
    if (finalRect.height >= viewportHeight - (2 * margin)) {
      floatingPreview.style.top = margin + "px";
    }
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
        hideFloatingPreview();
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
