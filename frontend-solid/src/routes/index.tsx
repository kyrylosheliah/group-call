import { A } from "@solidjs/router";
import { useCallRoomContext } from "~/providers/CallRoomProvider";

export default function Home() {
  const { userName, setUserName, saveUserName } = useCallRoomContext();

  return (
    <main class="text-center mx-auto text-gray-700 p-4 bg-gray-100 flex items-center justify-center min-h-screen">
      <div class="bg-white p-8 rounded-2xl shadow-md w-full max-w-md text-center">
        <h1 class="text-2xl font-bold mb-6 text-gray-800">Enter Your Info</h1>
        <div>
          <input
            type="text"
            placeholder="Pick your display name ..."
            onchange={(e) => setUserName(e.target.value)}
            value={userName()}
            class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <button
            type="button"
            class="w-full bg-blue-600 text-white py-3 rounded-xl hover:bg-blue-700 transition"
            onClick={() => saveUserName()}
            textContent="Save"
          />
        </div>
        <A href="/room" children="Pick a room" />
      </div>
    </main>
  );
}
