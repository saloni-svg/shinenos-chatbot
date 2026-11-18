import Chat from "@/components/Chat";

export const metadata = { title: "SHINENOS Chat" };

export default function Embed() {
  return (
    <main className="h-dvh bg-white">
      <Chat embedded />
    </main>
  );
}
