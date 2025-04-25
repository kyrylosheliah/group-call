import { createSignal, For, onMount } from "solid-js";
import { ServerWebSocketConnectionProvider, useServerWebSocket } from "~/providers/WebSocketConnection";

const CallRoom = () => {
  let inputRef: HTMLInputElement | undefined;
  let localVideoRef: HTMLVideoElement | undefined;

  const [socket, _] = useServerWebSocket();

  const [messages, setMessages] = createSignal<string[]>([]);
  const [peers, setPeers] = createSignal<Record<string, RTCPeerConnection>>({});
  const [localStream, setLocalStream] = createSignal<MediaStream | null>(null);
  const videoRefs: Record<string, HTMLVideoElement | null> = {};

  const updatePeers = (id: string, pc: RTCPeerConnection) => {
    setPeers((prev) => ({ ...prev, [id]: pc }));
  };

  const handleSignal = async (data: any) => {
    const peerMap = peers();
    const pc = peerMap[data.from] || createPeerConnection(data.from);
    if (data.signal.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(data.from, pc.localDescription);
    } else if (data.signal.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
    } else if (data.signal.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(data.signal));
    }
  };

  const createPeerConnection = (id: string) => {
    const pc = new RTCPeerConnection();
    const stream = localStream();
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      sendSignal(id, e.candidate);
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

  const createOffer = async (id: string) => {
    const pc = createPeerConnection(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(id, pc.localDescription);
  };

  const sendSignal = (
    to: string,
    signal: RTCIceCandidate | RTCSessionDescription | null
  ) => {
    socket.send(JSON.stringify({ type: 'signal', to, signal }));
  };

  const sendChat = () => {
    if (inputRef?.value) {
      const test = JSON.stringify({ type: "chat", message: inputRef.value });
      console.log(test);
      socket.send(JSON.stringify({ type: "chat", message: inputRef.value }));
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
      socket.send(JSON.stringify({
        type: "file",
        fileName: file.name,
        fileData: base64,
      }));
    };
    reader.readAsDataURL(file);
  };

  onMount(() => {
    navigator.mediaDevices // could be undefined without tls
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        setLocalStream(stream);
        // tie the stream to markup
        localVideoRef!.srcObject = stream;
        // signal joining
        socket.send(
          JSON.stringify({
            type: "join",
            name: "User" + Math.floor(Math.random() * 1000),
          })
        );
      })
      .catch((e) => {
        console.log(e.name);
      });
    socket.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "user-joined":
          await createOffer(data.id);
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
    <ServerWebSocketConnectionProvider>
      <div>
        <h2>WebRTC Chat (SolidJS)</h2>
        <video ref={localVideoRef} autoplay muted width="200" />
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
    </ServerWebSocketConnectionProvider>
  );
};

export default CallRoom;
