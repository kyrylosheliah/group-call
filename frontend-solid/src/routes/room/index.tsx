import { useNavigate } from "@solidjs/router";
import { useCallRoomContext } from "~/providers/CallRoomProvider";

export default function GroupCall() {
  const navigate = useNavigate();

  const {roomName, setRoomName} = useCallRoomContext();

  const inputEmpty = () => roomName().length == 0;

  const join = () => {
    console.log(`/room/${roomName()}`);
    navigate(`/room/${roomName()}`);
  };

  return (
    <main class="text-center mx-auto text-gray-700 p-4 bg-gray-100 flex items-center justify-center min-h-screen">
      <div class="bg-white p-8 rounded-2xl shadow-lg w-full max-w-md text-center">
        <h1 class="text-2xl font-bold mb-6 text-gray-800">Join a Group Call</h1>
        <input
          type="text"
          placeholder="room name ..."
          required
          onInput={(e) => setRoomName(e.target.value)}
          value={roomName()}
          class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          disabled={inputEmpty()}
          onClick={join}
          textContent={"Join"}
          class="w-full bg-blue-600 text-white py-3 rounded-xl hover:bg-blue-700 transition"
        />
      </div>
    </main>
  );
}
