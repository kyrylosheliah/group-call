import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { onMount } from "solid-js";
import CallRoom from "~/components/CallRoom";
import { useCallRoomContext } from "~/providers/CallRoomProvider";

export default function CallRoomPage() {
  const navigate = useNavigate();

  const leave = () => navigate("../");

  const location = useLocation();

  const tail = () => {
    const segments = location.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || '';
  };

  const {setRoomName} = useCallRoomContext();

  onMount(() => {
    setRoomName(tail());
  });

  return (
    <main class="text-center mx-auto text-gray-700 p-4">
      <div>
        <button onClick={leave}>Leave</button>
      </div>
        <CallRoom />
    </main>
  );
}
