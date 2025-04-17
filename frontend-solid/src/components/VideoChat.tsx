import { createSignal, For, onMount } from "solid-js";

const SERVER_PORT = 3000;
const ws = new WebSocket(`ws://localhost:${SERVER_PORT}`);

const VideoChat = () => {
  const [messages, setMessages] = createSignal<string[]>([]);
  const [peers, setPeers] = createSignal<Record<string, RTCPeerConnection>>({});
  const [localStream, setLocalStream] = createSignal<MediaStream | null>(null);
  const videoRefs: Record<string, HTMLVideoElement | null> = {};
  let inputRef: HTMLInputElement | undefined;

  const updatePeers = (id: string, pc: RTCPeerConnection) => {
    setPeers((prev) => ({ ...prev, [id]: pc }));
  };

  const handleSignal = async (data: any) => {
    const peerMap = peers();
    const pc = peerMap[data.from] || createPeer(data.from);
    if (data.signal.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(
        JSON.stringify({
          type: "signal",
          to: data.from,
          signal: pc.localDescription,
        })
      );
    } else if (data.signal.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
    } else if (data.signal.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(data.signal));
    }
  };

  const createPeer = (id: string) => {
    const pc = new RTCPeerConnection();
    const stream = localStream();
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      ws.send(JSON.stringify({ type: "signal", to: id, signal: e.candidate }));
    };
    pc.ontrack = (e) => {
      const remoteStream = e.streams[0];
      const el = videoRefs[id];
      if (el && remoteStream) {
        el.srcObject = remoteStream;
      }
    };
    updatePeers(id, pc);
    return pc;
  };

  const callUser = async (id: string) => {
    const pc = createPeer(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(
      JSON.stringify({ type: "signal", to: id, signal: pc.localDescription })
    );
  };

  const sendChat = () => {
    if (inputRef?.value) {
      const test = JSON.stringify({ type: "chat", message: inputRef.value });
      console.log(test);
      ws.send(JSON.stringify({ type: "chat", message: inputRef.value }));
      inputRef.value = "";
    }
  };

  const sendFile = (e: Event) => {
    const fileInput = e.currentTarget as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      ws.send(
        JSON.stringify({
          type: "file",
          fileName: file.name,
          fileDate: base64,
        })
      );
    };
    reader.readAsDataURL(file);
  };

  onMount(() => {
    console.log("mount\n");
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        setLocalStream(stream);
        const localVideo = document.getElementById("local") as HTMLVideoElement;
        if (localVideo) localVideo.srcObject = stream;
        ws.send(
          JSON.stringify({
            type: "join",
            name: "User" + Math.floor(Math.random() * 1000),
          })
        );
      })
      .catch((e) => {
        console.log(e.name);
      });
    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "user-joined":
          await callUser(data.id);
          break;
        case "signal":
          await handleSignal(data);
          break;
        case "chat":
          setMessages([...messages(), `[${data.from}]: ${data.message}`]);
          break;
        case "file":
          setMessages([
            ...messages(),
            `[${data.from}] Shared: <a href="${data.fileUrl}" target="_blank">${data.fileName}</a>`,
          ]);
          break;
      }
    };
  });

  return (
    <div>
      <h2>WebRTC Chat (SolidJS)</h2>
      <video id="local" autoplay muted width="200" />
      <For each={Object.keys(peers())}>
        {(id) => <video
          ref={(el) => videoRefs[id] = el}
          autoplay
          width="200"
        />}
      </For>
      <input ref={inputRef} placeholder="Message" />
      <button onClick={sendChat}>Send</button>
      <input type="file" onChange={sendFile} />
      <For each={messages()}>
        {(message) => <div>{message}</div>}
      </For>
    </div>
  );
};

export default VideoChat;
