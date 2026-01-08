import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, ExternalLink, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import TableOfContents from "@/components/legal/TableOfContents";
import LegalSection from "@/components/legal/LegalSection";
import BackToTop from "@/components/legal/BackToTop";
import { LEGAL_CONFIG } from "@/config/legal";

const Privacy = () => {
  const [activeSection, setActiveSection] = useState("");

  useEffect(() => {
    const observerOptions = {
      root: null,
      rootMargin: "-100px 0px -66%",
      threshold: 0,
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveSection(entry.target.id);
        }
      });
    }, observerOptions);

    const sections = document.querySelectorAll("section[id]");
    sections.forEach((section) => observer.observe(section));

    return () => {
      sections.forEach((section) => observer.unobserve(section));
    };
  }, []);

  const tocItems = [
    { id: "introduction", label: "Introduction" },
    { id: "information-we-collect", label: "Information We Collect" },
    { id: "how-we-use", label: "How We Use Your Information" },
    { id: "google-api-services", label: "Google API Services" },
    { id: "data-storage", label: "Data Storage and Security" },
    { id: "data-sharing", label: "Data Sharing and Disclosure" },
    { id: "third-party-services", label: "Third-Party Services" },
    { id: "your-rights", label: "Your Rights and Choices" },
    { id: "google-account-permissions", label: "Google Account Permissions" },
    { id: "children-privacy", label: "Children's Privacy" },
    { id: "international-transfers", label: "International Data Transfers" },
    { id: "changes", label: "Changes to This Privacy Policy" },
    { id: "contact", label: "Contact Us" },
    { id: "compliance", label: "Compliance" },
  ];

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/80 backdrop-blur-xl sticky top-0 z-30">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2 group">
              <MessageSquare className="h-6 w-6 text-primary group-hover:scale-110 transition-transform" />
              <span className="text-xl font-bold gradient-text">WhatsApp AI Assistant</span>
            </Link>
            <Link to="/">
              <Button variant="ghost" className="hover:bg-white/10 text-gray-300">
                Back to Home
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 container mx-auto px-4 pt-16 pb-12 text-center">
        <div className="max-w-4xl mx-auto space-y-6 animate-fade-in-up">
          <h1 className="text-5xl md:text-6xl font-bold text-white">Privacy Policy</h1>
          <p className="text-gray-400 text-lg">
            Last Updated: <span className="text-white font-semibold">{LEGAL_CONFIG.lastUpdated}</span>
          </p>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
            Your privacy is important to us. This Privacy Policy explains how {LEGAL_CONFIG.companyName} collects, uses, 
            and protects your information when you use our services.
          </p>
        </div>
      </section>

      {/* Main Content */}
      <div className="container mx-auto px-4 pb-24">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-4 gap-8">
          {/* Table of Contents */}
          <div className="lg:col-span-1">
            <TableOfContents items={tocItems} activeSection={activeSection} />
          </div>

          {/* Content Area */}
          <main className="lg:col-span-3">
            <div className="glass-card p-8 md:p-12 border-white/10 max-w-4xl">
              <LegalSection id="introduction" title="1. Introduction">
                <p className="mb-4">
                  Welcome to {LEGAL_CONFIG.companyName} ("we," "our," or "us"). We are committed to protecting your 
                  privacy and ensuring transparency about how we collect, use, and safeguard your personal information.
                </p>
                <p className="mb-4">
                  This Privacy Policy describes our practices regarding the collection, use, and disclosure of information 
                  when you use our WhatsApp AI Assistant platform and related services (collectively, the "Service").
                </p>
                <p className="mb-4">
                  By using our Service, you agree to the collection and use of information in accordance with this policy. 
                  If you do not agree with our policies and practices, please do not use our Service.
                </p>
              </LegalSection>

              <LegalSection id="information-we-collect" title="2. Information We Collect">
                <h3 className="text-xl font-semibold text-white mb-3 mt-6">2.1 Information You Provide</h3>
                <p className="mb-4">
                  We collect information that you provide directly to us, including:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li><strong className="text-white">Account Information:</strong> Name, email address, phone number, company name, and password when you create an account</li>
                  <li><strong className="text-white">Agent Configuration:</strong> Agent names, descriptions, system prompts, WhatsApp phone numbers, and integration endpoints</li>
                  <li><strong className="text-white">Contact Information:</strong> Contact lists and customer data you upload to the Service</li>
                  <li><strong className="text-white">Communication Data:</strong> Messages, conversations, and interactions with your AI agents</li>
                  <li><strong className="text-white">Support Information:</strong> Information you provide when contacting our support team</li>
                </ul>

                <h3 className="text-xl font-semibold text-white mb-3 mt-6">2.2 Automatically Collected Information</h3>
                <p className="mb-4">
                  When you use our Service, we automatically collect certain information, including:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li><strong className="text-white">Usage Data:</strong> How you interact with the Service, features used, and time spent</li>
                  <li><strong className="text-white">Device Information:</strong> IP address, browser type, operating system, device identifiers</li>
                  <li><strong className="text-white">Log Data:</strong> Access times, pages viewed, clicks, and navigation patterns</li>
                  <li><strong className="text-white">Cookies and Tracking:</strong> We use cookies and similar technologies to track activity and preferences</li>
                </ul>

                <h3 className="text-xl font-semibold text-white mb-3 mt-6">2.3 Google Account Information</h3>
                <p className="mb-4">
                  If you choose to sign in with Google, we collect information from your Google account as permitted by 
                  your account settings and Google's API Services User Data Policy. This may include:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>Basic profile information (name, email address, profile picture)</li>
                  <li>Account identifiers necessary for authentication</li>
                </ul>
                <p className="mb-4 text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-lg p-4">
                  <strong>Important:</strong> We use Google API Services in accordance with Google's Limited Use requirements. 
                  We do not use Google user data for advertising purposes or share it with third parties except as described in this policy.
                </p>
              </LegalSection>

              <LegalSection id="how-we-use" title="3. How We Use Your Information">
                <p className="mb-4">
                  We use the information we collect for the following purposes:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li><strong className="text-white">Service Delivery:</strong> To provide, maintain, and improve our Service</li>
                  <li><strong className="text-white">Agent Management:</strong> To create, configure, and manage your AI agents</li>
                  <li><strong className="text-white">Communication:</strong> To process and deliver messages through WhatsApp</li>
                  <li><strong className="text-white">Authentication:</strong> To verify your identity and manage your account</li>
                  <li><strong className="text-white">Customer Support:</strong> To respond to your inquiries and provide technical support</li>
                  <li><strong className="text-white">Analytics:</strong> To analyze usage patterns and improve Service performance</li>
                  <li><strong className="text-white">Security:</strong> To detect, prevent, and address security issues and fraud</li>
                  <li><strong className="text-white">Legal Compliance:</strong> To comply with legal obligations and enforce our terms</li>
                  <li><strong className="text-white">Notifications:</strong> To send you service-related updates and important information</li>
                </ul>
              </LegalSection>

              <LegalSection id="google-api-services" title="4. Google API Services">
                <p className="mb-4 text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-lg p-4">
                  <strong>CRITICAL - Limited Use Disclosure:</strong> Our use of information received from Google APIs adheres to the 
                  <a 
                    href={LEGAL_CONFIG.googleApiServicesPolicy} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline ml-1"
                  >
                    Google API Services User Data Policy
                    <ExternalLink className="inline h-3 w-3 ml-1" />
                  </a>, including the Limited Use requirements.
                </p>
                <p className="mb-4">
                  We use Google API Services solely for the following purposes:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>To authenticate your identity when you sign in with Google</li>
                  <li>To provide you with access to our Service</li>
                  <li>To maintain your account and preferences</li>
                </ul>
                <p className="mb-4">
                  <strong className="text-white">We do NOT:</strong>
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>Use Google user data for advertising purposes</li>
                  <li>Share Google user data with third parties except as required by law</li>
                  <li>Transfer Google user data to third parties without your explicit consent</li>
                  <li>Use Google user data for purposes other than those disclosed in this policy</li>
                </ul>
                <p className="mb-4">
                  You can revoke our access to your Google account at any time by visiting the{" "}
                  <a 
                    href={LEGAL_CONFIG.googleAccountPermissions} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Google Account Permissions page
                    <ExternalLink className="inline h-3 w-3 ml-1" />
                  </a>.
                </p>
              </LegalSection>

              <LegalSection id="data-storage" title="5. Data Storage and Security">
                <p className="mb-4">
                  We implement industry-standard security measures to protect your information:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li><strong className="text-white">Encryption:</strong> Data is encrypted in transit (TLS/SSL) and at rest</li>
                  <li><strong className="text-white">Access Controls:</strong> Limited access to personal data on a need-to-know basis</li>
                  <li><strong className="text-white">Secure Infrastructure:</strong> Data stored on secure cloud servers with regular security audits</li>
                  <li><strong className="text-white">Authentication:</strong> Strong password requirements and secure authentication methods</li>
                  <li><strong className="text-white">Monitoring:</strong> Continuous monitoring for security threats and vulnerabilities</li>
                </ul>
                <p className="mb-4">
                  However, no method of transmission over the Internet or electronic storage is 100% secure. While we strive 
                  to use commercially acceptable means to protect your information, we cannot guarantee absolute security.
                </p>
                <p className="mb-4">
                  <strong className="text-white">Data Retention:</strong> We retain your information for as long as necessary to provide 
                  the Service and fulfill the purposes outlined in this policy, unless a longer retention period is required by law.
                </p>
              </LegalSection>

              <LegalSection id="data-sharing" title="6. Data Sharing and Disclosure">
                <p className="mb-4">
                  We do not sell your personal information. We may share your information only in the following circumstances:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li><strong className="text-white">Service Providers:</strong> With trusted third-party service providers who assist in operating our Service (e.g., cloud hosting, analytics, payment processing)</li>
                  <li><strong className="text-white">Legal Requirements:</strong> When required by law, court order, or government regulation</li>
                  <li><strong className="text-white">Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
                  <li><strong className="text-white">Protection of Rights:</strong> To protect our rights, property, or safety, or that of our users</li>
                  <li><strong className="text-white">With Your Consent:</strong> When you explicitly authorize us to share your information</li>
                </ul>
                <p className="mb-4">
                  All service providers are contractually obligated to protect your information and use it only for the purposes 
                  we specify.
                </p>
              </LegalSection>

              <LegalSection id="third-party-services" title="7. Third-Party Services">
                <p className="mb-4">
                  Our Service may contain links to third-party websites or integrate with third-party services. We are not 
                  responsible for the privacy practices of these third parties. We encourage you to review their privacy policies.
                </p>
                <p className="mb-4">
                  Third-party services we use include:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li><strong className="text-white">WhatsApp:</strong> For messaging functionality (subject to WhatsApp's privacy policy)</li>
                  <li><strong className="text-white">Google:</strong> For authentication and API services (subject to Google's privacy policy)</li>
                  <li><strong className="text-white">Cloud Providers:</strong> For hosting and infrastructure services</li>
                  <li><strong className="text-white">Analytics Services:</strong> For understanding Service usage and performance</li>
                </ul>
              </LegalSection>

              <LegalSection id="your-rights" title="8. Your Rights and Choices">
                <p className="mb-4">
                  Depending on your location, you may have the following rights regarding your personal information:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li><strong className="text-white">Access:</strong> Request a copy of the personal information we hold about you</li>
                  <li><strong className="text-white">Correction:</strong> Request correction of inaccurate or incomplete information</li>
                  <li><strong className="text-white">Deletion:</strong> Request deletion of your personal information</li>
                  <li><strong className="text-white">Portability:</strong> Request transfer of your data to another service</li>
                  <li><strong className="text-white">Objection:</strong> Object to certain processing activities</li>
                  <li><strong className="text-white">Restriction:</strong> Request restriction of processing</li>
                  <li><strong className="text-white">Withdraw Consent:</strong> Withdraw consent where processing is based on consent</li>
                </ul>
                <p className="mb-4">
                  To exercise these rights, please contact us at{" "}
                  <a href={`mailto:${LEGAL_CONFIG.contactEmail}`} className="text-primary hover:underline">
                    {LEGAL_CONFIG.contactEmail}
                  </a>.
                </p>
                <p className="mb-4">
                  You can also manage your account settings, update your information, or delete your account through 
                  your account dashboard.
                </p>
              </LegalSection>

              <LegalSection id="google-account-permissions" title="9. Google Account Permissions">
                <p className="mb-4">
                  If you signed in with Google, you can manage or revoke our access to your Google account at any time:
                </p>
                <ol className="list-decimal list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>Visit the{" "}
                    <a 
                      href={LEGAL_CONFIG.googleAccountPermissions} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      Google Account Permissions page
                      <ExternalLink className="inline h-3 w-3 ml-1" />
                    </a>
                  </li>
                  <li>Find {LEGAL_CONFIG.companyName} in the list of connected apps</li>
                  <li>Click "Remove Access" to revoke our access to your Google account</li>
                </ol>
                <p className="mb-4">
                  <strong className="text-white">Note:</strong> Revoking access will prevent you from signing in with Google, 
                  but you can still access your account using email and password if you have set one up.
                </p>
              </LegalSection>

              <LegalSection id="children-privacy" title="10. Children's Privacy">
                <p className="mb-4">
                  Our Service is not intended for children under the age of 13 (or the minimum age in your jurisdiction). 
                  We do not knowingly collect personal information from children.
                </p>
                <p className="mb-4">
                  If you are a parent or guardian and believe your child has provided us with personal information, please 
                  contact us immediately. If we become aware that we have collected information from a child without parental 
                  consent, we will take steps to delete that information.
                </p>
              </LegalSection>

              <LegalSection id="international-transfers" title="11. International Data Transfers">
                <p className="mb-4">
                  Your information may be transferred to and processed in countries other than your country of residence. 
                  These countries may have data protection laws that differ from those in your country.
                </p>
                <p className="mb-4">
                  By using our Service, you consent to the transfer of your information to these countries. We take appropriate 
                  safeguards to ensure your information receives adequate protection in accordance with this Privacy Policy.
                </p>
              </LegalSection>

              <LegalSection id="changes" title="12. Changes to This Privacy Policy">
                <p className="mb-4">
                  We may update this Privacy Policy from time to time. We will notify you of any material changes by:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>Posting the new Privacy Policy on this page</li>
                  <li>Updating the "Last Updated" date at the top of this policy</li>
                  <li>Sending you an email notification (for significant changes)</li>
                  <li>Displaying a notice on our Service</li>
                </ul>
                <p className="mb-4">
                  Your continued use of the Service after changes become effective constitutes acceptance of the updated policy.
                </p>
              </LegalSection>

              <LegalSection id="contact" title="13. Contact Us">
                <p className="mb-4">
                  If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:
                </p>
                <div className="bg-white/5 border border-white/10 rounded-lg p-6 mb-6">
                  <p className="mb-2">
                    <strong className="text-white">Email:</strong>{" "}
                    <a href={`mailto:${LEGAL_CONFIG.contactEmail}`} className="text-primary hover:underline flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      {LEGAL_CONFIG.contactEmail}
                    </a>
                  </p>
                  <p className="mb-2">
                    <strong className="text-white">Website:</strong>{" "}
                    <a href={LEGAL_CONFIG.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {LEGAL_CONFIG.websiteUrl}
                      <ExternalLink className="inline h-3 w-3 ml-1" />
                    </a>
                  </p>
                  <p>
                    <strong className="text-white">Address:</strong> {LEGAL_CONFIG.companyAddress}
                  </p>
                </div>
              </LegalSection>

              <LegalSection id="compliance" title="14. Compliance">
                <p className="mb-4">
                  We are committed to complying with applicable data protection laws, including:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>General Data Protection Regulation (GDPR) for users in the European Union</li>
                  <li>California Consumer Privacy Act (CCPA) for users in California</li>
                  <li>Other applicable regional data protection laws</li>
                </ul>
                <p className="mb-4">
                  If you believe we have not addressed your privacy concerns adequately, you have the right to file a complaint 
                  with your local data protection authority.
                </p>
              </LegalSection>

              {/* Questions Section */}
              <div className="mt-12 pt-8 border-t border-white/10">
                <div className="glass-card p-6 border-primary/20">
                  <h3 className="text-2xl font-bold text-white mb-4">Questions?</h3>
                  <p className="text-gray-300 mb-4">
                    If you have any questions about this Privacy Policy or our privacy practices, please don't hesitate to contact us.
                  </p>
                  <Link to="/">
                    <Button className="bg-gradient-primary shadow-glow hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)]">
                      Return to Home
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      <BackToTop />
    </div>
  );
};

export default Privacy;

