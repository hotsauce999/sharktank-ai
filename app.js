document.addEventListener("DOMContentLoaded", () => {
  const API_CONFIG = {
    apiKey: "ZmVjNDdmZDM5NmYwNGRmMmE5NTcyYjQ1YzA1YjNiY2EtMTc1MDc2NTYwMg==",
    serverUrl: "https://api.heygen.com",
  };

  let sessionInfo = null;
  let room = null;
  let mediaStream = null;
  let webSocket = null;
  let sessionToken = null;
  let transcriptLog = [];
  let heygenKnowledge = "";

  const mediaElement = document.getElementById("mediaElement");
  const taskInput = document.getElementById("taskInput");
  const micBtn = document.getElementById("micBtn");
  const startBtn = document.getElementById("startBtn");
  const talkBtn = document.getElementById("talkBtn");
  const endSessionBtn = document.querySelector(".end-button");
  const inputArea = document.querySelector(".input-area");
  const timerDisplay = document.querySelector(".time-box");

  const loadingOverlay = document.createElement("div");
  loadingOverlay.style.position = "fixed";
  loadingOverlay.style.top = 0;
  loadingOverlay.style.left = 0;
  loadingOverlay.style.width = "100%";
  loadingOverlay.style.height = "100%";
  loadingOverlay.style.background = "rgba(0, 0, 0, 0.8)";
  loadingOverlay.style.color = "white";
  loadingOverlay.style.fontSize = "24px";
  loadingOverlay.style.display = "flex";
  loadingOverlay.style.justifyContent = "center";
  loadingOverlay.style.alignItems = "center";
  loadingOverlay.style.zIndex = 1000;
  loadingOverlay.innerText = "Loading Avatar...";
  loadingOverlay.style.display = "none";
  document.body.appendChild(loadingOverlay);

  let countdownInterval;
  let remainingTime = 300;

  function startCountdown() {
    if (!timerDisplay) return;
    countdownInterval = setInterval(() => {
      remainingTime--;
      const minutes = Math.floor(remainingTime / 60);
      const seconds = remainingTime % 60;
      timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      if (remainingTime <= 0) {
        clearInterval(countdownInterval);
        closeSession();
      }
    }, 1000);
  }

  const toggleBtn = document.createElement("button");
  toggleBtn.textContent = "Switch to Chat";
  toggleBtn.className = "btn-secondary mt-2";
  toggleBtn.style.display = "none";
  if (startBtn && startBtn.parentNode) startBtn.parentNode.insertBefore(toggleBtn, startBtn.nextSibling);

  let mode = "voice";
  if (micBtn) micBtn.style.display = "none";
  if (inputArea) inputArea.style.display = "none";

  async function getSessionToken() {
    const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.create_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": API_CONFIG.apiKey,
      },
    });
    const data = await response.json();
    sessionToken = data.data.token;
  }

  async function connectWebSocket(sessionId) {
    const params = new URLSearchParams({
      session_id: sessionId,
      session_token: sessionToken,
      silence_response: false,
      opening_text: "Hello, how can I help you?",
      stt_language: "en",
    });

    const wsUrl = `wss://${new URL(API_CONFIG.serverUrl).hostname}/v1/ws/streaming.chat?${params}`;
    webSocket = new WebSocket(wsUrl);

    webSocket.addEventListener("message", (event) => {
      const eventData = JSON.parse(event.data);
      if (eventData.type === "USER_TALKING_MESSAGE") {
        transcriptLog.push({
          speaker: "user",
          text: eventData.text,
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  let avatarBuffer = [];
  let avatarSpeaking = false;

  // Load the knowledge base from file (async)
  async function loadKnowledgeBase() {
    // Use .txt or .json depending on your file
    const response = await fetch('/max.txt'); 
    // If it's text:
    heygenKnowledge = await response.text();
    // If it's json, do:   heygenKnowledge = await response.json();
  }


  async function createNewSession() {
    if (!sessionToken) await getSessionToken();

    loadingOverlay.style.display = "flex";
    await loadKnowledgeBase();
    const response = await fetch(`${API_CONFIG.serverUrl}/v1/streaming.new`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        quality: "high",
        avatar_name: "Dexter_Lawyer_Sitting_public",
        version: "v2",
        video_encoding: "H264",
        knowledge_base: heygenKnowledge
      }),
    });

    const data = await response.json();
    sessionInfo = data.data;

    room = new LivekitClient.Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: {
        resolution: LivekitClient.VideoPresets.h720.resolution,
      },
    });

    room.on(LivekitClient.RoomEvent.DataReceived, (payload) => {
      const dataStr = new TextDecoder().decode(payload);
      try {
        const data = JSON.parse(dataStr);
        if (data.type === "avatar_start_talking") {
          avatarSpeaking = true;
          avatarBuffer = [];
        }
        if (data.type === "avatar_talking_message" && avatarSpeaking) {
          avatarBuffer.push(data.message);
        }
        if (data.type === "avatar_end_message" && avatarSpeaking) {
          const fullMessage = avatarBuffer.join(" ").replace(/\s+/g, " ").trim();
          transcriptLog.push({
            speaker: "avatar",
            text: fullMessage,
            timestamp: new Date().toISOString(),
          });
          avatarBuffer = [];
          avatarSpeaking = false;
        }
      } catch (e) {}
    });

    room.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === "video" || track.kind === "audio") {
        mediaStream.addTrack(track.mediaStreamTrack);
        if (
          mediaElement &&
          mediaStream.getVideoTracks().length > 0 &&
          mediaStream.getAudioTracks().length > 0
        ) {
          mediaElement.srcObject = mediaStream;
        }
      }
    });

    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
      const mediaTrack = track.mediaStreamTrack;
      if (mediaTrack) mediaStream.removeTrack(mediaTrack);
    });

    mediaStream = new MediaStream();
    await room.prepareConnection(sessionInfo.url, sessionInfo.access_token);
    await connectWebSocket(sessionInfo.session_id);
  }

  async function startStreamingSession() {
    await fetch(`${API_CONFIG.serverUrl}/v1/streaming.start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ session_id: sessionInfo.session_id }),
    });

    await room.connect(sessionInfo.url, sessionInfo.access_token);

    loadingOverlay.style.display = "none";

    if (startBtn) startBtn.style.display = "none";
    if (toggleBtn) toggleBtn.style.display = "block";
    if (micBtn) micBtn.style.display = "block";
    if (endSessionBtn) endSessionBtn.style.display = "block";
    if (inputArea) inputArea.style.display = "none";

    startCountdown();
  }

  toggleBtn.addEventListener("click", () => {
    if (mode === "voice") {
      mode = "chat";
      toggleBtn.textContent = "Switch to Voice";
      micBtn.style.display = "none";
      inputArea.style.display = "flex";
    } else {
      mode = "voice";
      toggleBtn.textContent = "Switch to Chat";
      micBtn.style.display = "block";
      inputArea.style.display = "none";
    }
  });

  if (startBtn)
    startBtn.addEventListener("click", async () => {
      await createNewSession();
      await startStreamingSession();
    });

  if (talkBtn)
    talkBtn.addEventListener("click", () => {
      const text = taskInput?.value.trim();
      if (text) {
        transcriptLog.push({ speaker: "user", text, timestamp: new Date().toISOString() });
        sendText(text, "talk");
        taskInput.value = "";
      }
    });
if (endSessionBtn) {
  endSessionBtn.addEventListener("click", () => {
    closeSession();
  });
}


  async function sendText(text, taskType = "talk") {
    if (!sessionInfo) return;

    await fetch(`${API_CONFIG.serverUrl}/v1/streaming.task`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        session_id: sessionInfo.session_id,
        text,
        task_type: taskType,
      }),
    });
  }

    function showEmailModal() {
    document.getElementById("emailModal").style.display = "flex";
    }

document.getElementById("emailForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  const email = document.getElementById("pitchEmail").value.trim();

  if (!email || !transcriptLog.length) {
    alert("Missing email or transcript!");
    return;
  }

  try {
    const data = { email: email, transcript: transcriptLog };
    const firebaseUrl = "https://punx-shark-tank-default-rtdb.firebaseio.com/transcripts.json";
    const response = await fetch(firebaseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    if (!response.ok) throw new Error("Failed to send data to Firebase");

    // Hide the email modal
    document.getElementById("emailModal").style.display = "none";
    // Show the processing/prompt modal
    document.getElementById("sentPromptModal").style.display = "flex";
  } catch (err) {
    alert("There was a problem saving your transcript: " + err.message);
  }
});

document.getElementById("sentPromptOkBtn").addEventListener("click", function () {
  document.getElementById("sentPromptModal").style.display = "none";
  window.location.href = "https://punx-agentspace.vercel.app"; // CHANGE this to your real homepage!
});

document.getElementById("goHomeBtn").addEventListener("click", function () {
  window.location.href = "https://punx-agentspace.vercel.app"; 
});

  async function closeSession() {
    if (!sessionInfo) return;

    await fetch(`${API_CONFIG.serverUrl}/v1/streaming.stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ session_id: sessionInfo.session_id }),
    });

    if (webSocket) webSocket.close();
    if (room) room.disconnect();
    if (mediaElement) mediaElement.srcObject = null;

    sessionInfo = null;
    room = null;
    mediaStream = null;
    sessionToken = null;
    avatarBuffer = [];
    avatarSpeaking = false;
    clearInterval(countdownInterval);

    if (startBtn) startBtn.style.display = "block";
    if (micBtn) micBtn.style.display = "none";
    if (inputArea) inputArea.style.display = "none";
    if (endSessionBtn) endSessionBtn.style.display = "none";
    if (toggleBtn) toggleBtn.style.display = "none";
    if (timerDisplay) timerDisplay.textContent = "10:00";

    showEmailModal();
  }

  // Speech Recognition
  window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let recognizing = false;

  if (window.SpeechRecognition) {
    recognition = new window.SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      recognizing = true;
    };

    recognition.onerror = (event) => {
      recognizing = false;
      console.error(`Speech recognition error: ${event.error}`);
    };

    recognition.onend = () => {
      recognizing = false;
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript.trim();
      if (transcript) {
        transcriptLog.push({
          speaker: "user",
          text: transcript,
          timestamp: new Date().toISOString(),
        });
        sendText(transcript, "talk");
      }
    };
  }

  document.addEventListener("keydown", (event) => {
    if (event.code === "Space" && recognition && !recognizing && mode === "voice") {
      event.preventDefault();
      recognizing = true;
      recognition.start();
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.code === "Space" && recognition && recognizing && mode === "voice") {
      event.preventDefault();
      recognition.stop();
    }
  });
});
