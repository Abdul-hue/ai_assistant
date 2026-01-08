import { useEffect, useState } from "react";
import { ChevronUp } from "lucide-react";

interface TocItem {
  id: string;
  label: string;
  level?: number;
}

interface TableOfContentsProps {
  items: TocItem[];
  activeSection?: string;
  className?: string;
}

const TableOfContents = ({ items, activeSection, className = "" }: TableOfContentsProps) => {
  const [isSticky, setIsSticky] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsSticky(window.scrollY > 200);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      const offset = 100; // Account for sticky header
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });
    }
    setIsMobileOpen(false);
  };

  return (
    <>
      {/* Mobile TOC Button */}
      <button
        onClick={() => setIsMobileOpen(!isMobileOpen)}
        className={`lg:hidden fixed bottom-6 right-6 z-50 bg-primary text-white p-4 rounded-full shadow-glow hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)] transition-all duration-300 ${
          isSticky ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
        }`}
        aria-label="Toggle table of contents"
      >
        <ChevronUp className={`h-5 w-5 transition-transform duration-300 ${isMobileOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Desktop Sticky TOC */}
      <aside
        className={`hidden lg:block ${className} ${
          isSticky ? "fixed top-24" : "sticky top-24"
        } max-h-[calc(100vh-8rem)] overflow-y-auto`}
      >
        <div className="glass-card p-6 border-white/10">
          <h3 className="text-lg font-semibold text-white mb-4">Table of Contents</h3>
          <nav className="space-y-2">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={`block w-full text-left px-3 py-2 rounded-md transition-all duration-300 text-sm ${
                  activeSection === item.id
                    ? "bg-primary/20 text-primary border-l-2 border-primary"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
                style={{ paddingLeft: item.level && item.level > 1 ? `${item.level * 0.75}rem` : "0.75rem" }}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* Mobile TOC Modal */}
      {isMobileOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            onClick={() => setIsMobileOpen(false)}
          />
          <aside className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0a] border-t border-white/10 max-h-[60vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Table of Contents</h3>
                <button
                  onClick={() => setIsMobileOpen(false)}
                  className="text-gray-400 hover:text-white"
                >
                  ×
                </button>
              </div>
              <nav className="space-y-2">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => scrollToSection(item.id)}
                    className={`block w-full text-left px-3 py-2 rounded-md transition-all duration-300 text-sm ${
                      activeSection === item.id
                        ? "bg-primary/20 text-primary border-l-2 border-primary"
                        : "text-gray-400 hover:text-white hover:bg-white/5"
                    }`}
                    style={{ paddingLeft: item.level && item.level > 1 ? `${item.level * 0.75}rem` : "0.75rem" }}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>
          </aside>
        </>
      )}
    </>
  );
};

export default TableOfContents;

