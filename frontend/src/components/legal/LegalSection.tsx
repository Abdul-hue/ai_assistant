import { ReactNode } from "react";

interface LegalSectionProps {
  id: string;
  title: string;
  children: ReactNode;
  level?: 1 | 2 | 3;
  className?: string;
}

const LegalSection = ({ id, title, children, level = 2, className = "" }: LegalSectionProps) => {
  const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements;
  
  const headingClasses = {
    1: "text-4xl font-bold text-white mb-6 mt-12",
    2: "text-3xl font-bold text-white mb-4 mt-10",
    3: "text-2xl font-semibold text-white mb-3 mt-8",
  };

  return (
    <section id={id} className={`scroll-mt-24 ${className}`}>
      <HeadingTag className={headingClasses[level]}>
        {title}
      </HeadingTag>
      <div className="prose prose-invert max-w-none text-gray-300 leading-relaxed">
        {children}
      </div>
    </section>
  );
};

export default LegalSection;

