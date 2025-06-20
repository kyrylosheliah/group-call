import { useNavigate, useParams } from "@solidjs/router";
import CallRoom from "~/components/CallRoom";
import { CallRoomContextProvider } from "~/providers/CallRoomProvider";

export default function CallRoomPage() {
  const params = useParams();

  const navigate = useNavigate();
  const leave = () => {
    navigate("../");
  };

  return (
    <main class="text-center mx-auto text-gray-700 p-4">
      <div>
        <button onClick={leave}>Leave</button>
      </div>
      <CallRoomContextProvider roomName={() => params.id}>
        <CallRoom />
      </CallRoomContextProvider>
    </main>
  );
}
