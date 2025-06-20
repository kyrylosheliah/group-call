import { createEffect, For, on, onCleanup, onMount, Show } from "solid-js";
import { logComponent } from "~/utils/logging";
import { useCallRoomContext } from "~/providers/CallRoomProvider";

const CallRoom = () => {
  let localVideoRef: HTMLVideoElement | undefined;

  const {
    localMediaStream,
    consumerTransports,
    logState,
    roomName,
    join,
    leave,
  } = useCallRoomContext();

  onMount(join);
  onCleanup(leave);

  createEffect(on(localMediaStream, (lms) => {
    if (lms === undefined) return;
    localVideoRef!.srcObject = new MediaStream([...lms.getVideoTracks()]);
  }));

  // const [socket, _] = useServerWebSocket();

  // const [messages, setMessages] = createSignal<string[]>([]);
  // const [peers, setPeers] = createSignal<Record<string, RTCPeerConnection>>({});

  // const sendChat = () => {
  //   if (inputRef?.value) {
  //     const test = JSON.stringify({ type: "chat", message: inputRef.value });
  //     console.log(test);
  //     socket.send(JSON.stringify({ type: "chat", message: inputRef.value }));
  //     inputRef.value = "";
  //   }
  // };

  // const sendFile = (e: Event) => {
  //   const fileInput = e.currentTarget as HTMLInputElement;
  //   const file = fileInput.files?.[0];
  //   if (!file) return;
  //   const reader = new FileReader();
  //   reader.onload = () => {
  //     const base64 = (reader.result as string).split(",")[1];
  //     socket.send(JSON.stringify({
  //       type: "file",
  //       fileName: file.name,
  //       fileData: base64,
  //     }));
  //   };
  //   reader.readAsDataURL(file);
  // };

  // onMount(() => {
  //   socket.onmessage = async (event) => {
  //     const data = JSON.parse(event.data);
  //     switch (data.type) {
  //       case "user-joined":
  //         await createOffer(data.id);
  //         break;
  //       case "signal":
  //         await handleSignal(data);
  //         break;
  //       case "chat":
  //         setMessages([...messages(), `[${data.from}]: ${data.message}`]);
  //         break;
  //       case "file":
  //         setMessages([
  //           ...messages(),
  //           `[${data.from}] Shared: <a href="${data.fileUrl}" target="_blank">${data.fileName}</a>`,
  //         ]);
  //         break;
  //     }
  //   };
  // });

  // return (
  //   <ServerWebSocketConnectionProvider>
  //     <div>
  //       <h2>WebRTC Chat (SolidJS)</h2>
  //       <input ref={inputRef} placeholder="Message" />
  //       <button onClick={sendChat}>Send</button>
  //       <input type="file" onChange={sendFile} />
  //       <For each={messages()}>
  //         {(message) => <div>{message}</div>}
  //       </For>
  //     </div>
  //   </ServerWebSocketConnectionProvider>
  // );

  return (
    <div>
      <div>Room "{roomName()}"</div>
      <button onClick={logState}>log state</button>
      <div><video ref={localVideoRef} autoplay muted class="video" /></div>
      <Show
        fallback={<div>No room specified</div>}
        when={roomName()}
      >
        <Show
          fallback={<div>No other participants present</div>}
          when={consumerTransports().length}
        >
          <For each={consumerTransports()}>{(ct, index) => {
            switch (ct.consumer.kind) {
              case "video":
                return <video autoplay class="video" ref={(videoRef) => {
                  logComponent("rendering consumer source index", index());
                  videoRef.srcObject = new MediaStream([ct.consumer.track]);
                }}/>;
              case "audio":
                return <audio autoplay ref={(audioRef) => {
                  logComponent("rendering consumer source index", index());
                  audioRef.srcObject = new MediaStream([ct.consumer.track]);
                }}/>;
            }
            return <div>Unreachable</div>;
          }}</For>
        </Show>
      </Show>
    </div>
  );
};

export default CallRoom;
