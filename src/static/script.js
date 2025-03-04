document.addEventListener("DOMContentLoaded", function () {
  const logsDiv = document.getElementById("logs");
  const form = document.querySelector("form");
  const processed = document.getElementById("processed-count");
  const pictures = document.getElementById("pictures-count");
  const videos = document.getElementById("videos-count");
  const errors = document.getElementById("errors-count");
  let ws;

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
      }
      else if (event.data.includes("event-processed-pictures:")) {
        updateProcessedPictures();
      }
      else if (event.data.includes("event-processed-videos:")) {
        updateProcessedVideos();
      }
      else if (event.data.includes("event-error:")) {
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

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    const year = document.getElementById("year").value;
    const month = document.getElementById("month").value;
    const path = document.getElementById("path").value;
    logsDiv.innerHTML = "";
    processed.textContent = 0;
    pictures.textContent = 0;
    videos.textContent = 0;
    errors.textContent = 0;
    updateTotal(0);

    ws.send(JSON.stringify({ year: year, month: month, path: path }));
  });

  connectWebSocket();
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
