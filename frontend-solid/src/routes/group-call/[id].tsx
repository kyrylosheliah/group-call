import { useNavigate } from "@solidjs/router";
import GroupCall from "~/components/GroupCall";

export default function GroupCallRoom() {
  const navigate = useNavigate();
  const leave = () => {
    navigate(-1);
  };

  return (
    <main class="text-center mx-auto text-gray-700 p-4">
      <div><button onClick={leave}>Leave</button></div>
      <GroupCall />
    </main>
  );
}
