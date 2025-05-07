import { createEffect, For, on, Show } from "solid-js";

import { log1stage } from "~/utils/logging";
import { joinGroupCall } from "~/hooks/JoinGroupCall";

const GroupCall = (params: {
  roomName: string;
}) => {
  let localVideoRef: HTMLVideoElement | undefined;
  
  const {
    localMediaStream,
    consumerTransports,
    logState,
  } = joinGroupCall({
    roomName: params.roomName,
  });

  createEffect(on(localMediaStream, (lms) => {
    localVideoRef!.srcObject = lms;
  }));

  return (
    <div>
      <div>Room "{params.roomName}"</div>
      <button onClick={logState}>log state</button>
      <div><video ref={localVideoRef} autoplay muted class="video" /></div>
      <Show
        fallback={<div>No room specified</div>}
        when={params.roomName}
      >
        <Show
          fallback={<div>No other participants present</div>}
          when={consumerTransports().length}
        >
          <For each={consumerTransports()}>{(ct, index) => {
            if (ct.consumer.kind === "video") {
              return <video autoplay class="video" ref={(videoRef) => {
                log1stage("rendering consumer source index", index);
                videoRef.srcObject = new MediaStream([ct.consumer.track]);
              }}/>;
            } else if (ct.consumer.kind === "audio") {
              return <audio autoplay ref={(audioRef) => {
                log1stage("rendering consumer source index", index);
                audioRef.srcObject = new MediaStream([ct.consumer.track]);
              }}/>;
            }
            return <></>;
          }}</For>
        </Show>
      </Show>
    </div>
  );
};

export default GroupCall;
