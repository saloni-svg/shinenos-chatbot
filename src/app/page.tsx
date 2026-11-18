import Script from "next/script";

export default function Home() {
  return (
    <div className="min-h-dvh bg-[linear-gradient(100deg,#001746_0%,#002673_55%,#00358f_100%)]">
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-4 py-12">
        <section className="text-white">
          <div className="mb-8 inline-block rounded-2xl bg-white px-4 py-2 shadow-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="SHINENOS Cleaning Services" width={171} height={66} />
          </div>
          <h1 className="text-3xl font-bold leading-tight sm:text-[42px]">
            Ask <span className="text-orange">SHINENOS</span> anything
          </h1>
          <div className="my-6 h-[3px] w-[90px] bg-orange" />
          <p className="text-[15px] leading-relaxed text-white/80">
            Answers come straight from shinenos.com: services, the cities we serve, booking and cancellation policies,
            FAQs, gift cards and our cleaning blog. Ask a question, or leave your details for a quote.
          </p>
          <ul className="mt-6 space-y-2.5 text-sm text-white/90">
            <li>🔎 Searches the whole website on every question</li>
            <li>🔗 Links you to the exact page it used</li>
            <li>🌍 Replies in your language</li>
            <li>📝 Takes quote and callback requests</li>
          </ul>
          <p className="mt-10 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-white">
            <span className="text-orange">●</span> Click the chat bubble in the bottom-right corner to start chatting
          </p>
        </section>
        <Script src="/widget.js" strategy="lazyOnload" />
      </main>
    </div>
  );
}
