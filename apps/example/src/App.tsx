import "./App.css";

const sections = [
  {
    label: "Search",
    state: "Ready",
  },
  {
    label: "Details",
    state: "Ready",
  },
  {
    label: "Providers",
    state: "Ready",
  },
] as const;

// EN: Root React component for the Media Engine example application shell.
// RU: Корневой React component для оболочки example приложения Media Engine.
function App() {
  return (
    <main className="app-shell">
      <section className="overview" aria-labelledby="app-title">
        <div className="overview__heading">
          <p className="overview__eyebrow">Media Engine</p>
          <h1 id="app-title">Example App</h1>
        </div>

        <div className="overview__grid" aria-label="Example app sections">
          {sections.map((section) => (
            <article className="section-tile" key={section.label}>
              <span>{section.label}</span>
              <strong>{section.state}</strong>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
