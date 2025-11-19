import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, ExternalLink, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import TableOfContents from "@/components/legal/TableOfContents";
import LegalSection from "@/components/legal/LegalSection";
import BackToTop from "@/components/legal/BackToTop";
import { LEGAL_CONFIG } from "@/config/legal";

const Terms = () => {
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
    { id: "agreement", label: "Agreement to Terms" },
    { id: "description", label: "Description of Service" },
    { id: "account-registration", label: "Account Registration and Security" },
    { id: "acceptable-use", label: "Acceptable Use Policy" },
    { id: "intellectual-property", label: "Intellectual Property Rights" },
    { id: "google-api-services", label: "Google API Services" },
    { id: "data-privacy", label: "Data Privacy and Security" },
    { id: "service-availability", label: "Service Availability and Modifications" },
    { id: "fees-payment", label: "Fees and Payment" },
    { id: "disclaimers", label: "Disclaimers and Limitations of Liability" },
    { id: "indemnification", label: "Indemnification" },
    { id: "third-party-integrations", label: "Third-Party Integrations" },
    { id: "termination", label: "Termination" },
    { id: "dispute-resolution", label: "Dispute Resolution" },
    { id: "general-provisions", label: "General Provisions" },
    { id: "contact", label: "Contact Information" },
    { id: "updates", label: "Updates to Terms" },
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
          <h1 className="text-5xl md:text-6xl font-bold text-white">Terms of Service</h1>
          <p className="text-gray-400 text-lg">
            Last Updated: <span className="text-white font-semibold">{LEGAL_CONFIG.lastUpdated}</span>
          </p>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
            Please read these Terms of Service carefully before using {LEGAL_CONFIG.companyName}. By accessing or using 
            our Service, you agree to be bound by these Terms.
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
              <LegalSection id="agreement" title="1. Agreement to Terms">
                <p className="mb-4">
                  These Terms of Service ("Terms") constitute a legally binding agreement between you ("User," "you," or "your") 
                  and {LEGAL_CONFIG.companyName} ("Company," "we," "us," or "our") regarding your use of our WhatsApp AI Assistant 
                  platform and related services (collectively, the "Service").
                </p>
                <p className="mb-4">
                  By accessing, registering for, or using the Service, you acknowledge that you have read, understood, and agree 
                  to be bound by these Terms and our Privacy Policy, which is incorporated herein by reference.
                </p>
                <p className="mb-4">
                  If you do not agree to these Terms, you may not access or use the Service. These Terms apply to all users, 
                  including visitors, registered users, and others who access or use the Service.
                </p>
                <p className="mb-4 text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-lg p-4">
                  <strong>Important:</strong> If you are using the Service on behalf of an organization, you represent and warrant 
                  that you have the authority to bind that organization to these Terms, and "you" will refer to both you and the organization.
                </p>
              </LegalSection>

              <LegalSection id="description" title="2. Description of Service">
                <p className="mb-4">
                  {LEGAL_CONFIG.companyName} provides an AI-powered platform that enables businesses to create, configure, and manage 
                  intelligent WhatsApp agents. Our Service includes:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>AI agent creation and configuration tools</li>
                  <li>WhatsApp integration and messaging capabilities</li>
                  <li>Knowledge base management and file processing</li>
                  <li>Contact management and customer data handling</li>
                  <li>Integration endpoints for connecting to external systems</li>
                  <li>Analytics and reporting features</li>
                  <li>User account management and authentication</li>
                </ul>
                <p className="mb-4">
                  We reserve the right to modify, suspend, or discontinue any aspect of the Service at any time, with or without notice.
                </p>
              </LegalSection>

              <LegalSection id="account-registration" title="3. Account Registration and Security">
                <h3 className="text-xl font-semibold text-white mb-3 mt-6">3.1 Account Creation</h3>
                <p className="mb-4">
                  To use certain features of the Service, you must register for an account. You agree to:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>Provide accurate, current, and complete information during registration</li>
                  <li>Maintain and promptly update your account information</li>
                  <li>Maintain the security of your account credentials</li>
                  <li>Accept responsibility for all activities that occur under your account</li>
                  <li>Notify us immediately of any unauthorized use of your account</li>
                </ul>

                <h3 className="text-xl font-semibold text-white mb-3 mt-6">3.2 Account Security</h3>
                <p className="mb-4">
                  You are responsible for maintaining the confidentiality of your account password and for all activities that 
                  occur under your account. You agree to:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>Use a strong, unique password</li>
                  <li>Not share your account credentials with third parties</li>
                  <li>Log out of your account when using shared devices</li>
                  <li>Immediately notify us of any suspected security breach</li>
                </ul>
                <p className="mb-4">
                  We are not liable for any loss or damage arising from your failure to comply with these security obligations.
                </p>
              </LegalSection>

              <LegalSection id="acceptable-use" title="4. Acceptable Use Policy">
                <p className="mb-4">
                  You agree to use the Service only for lawful purposes and in accordance with these Terms. You agree NOT to:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>Violate any applicable laws, regulations, or third-party rights</li>
                  <li>Use the Service to transmit spam, unsolicited messages, or bulk communications</li>
                  <li>Impersonate any person or entity or misrepresent your affiliation</li>
                  <li>Interfere with or disrupt the Service or servers connected to the Service</li>
                  <li>Attempt to gain unauthorized access to any portion of the Service</li>
                  <li>Use automated systems (bots, scrapers) to access the Service without permission</li>
                  <li>Upload malicious code, viruses, or harmful content</li>
                  <li>Collect or harvest information about other users without consent</li>
                  <li>Use the Service for any illegal, fraudulent, or harmful purpose</li>
                  <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
                </ul>
                <p className="mb-4">
                  Violation of this Acceptable Use Policy may result in immediate termination of your account and access to the Service.
                </p>
              </LegalSection>

              <LegalSection id="intellectual-property" title="5. Intellectual Property Rights">
                <h3 className="text-xl font-semibold text-white mb-3 mt-6">5.1 Our Intellectual Property</h3>
                <p className="mb-4">
                  The Service, including its original content, features, functionality, design, and software, is owned by 
                  {LEGAL_CONFIG.companyName} and protected by international copyright, trademark, patent, trade secret, and other 
                  intellectual property laws.
                </p>
                <p className="mb-4">
                  These Terms grant you a limited, non-exclusive, non-transferable, revocable license to access and use the Service 
                  for your internal business purposes in accordance with these Terms.
                </p>

                <h3 className="text-xl font-semibold text-white mb-3 mt-6">5.2 Your Content</h3>
                <p className="mb-4">
                  You retain ownership of any content, data, or materials you upload, submit, or create through the Service ("Your Content"). 
                  By using the Service, you grant us a worldwide, non-exclusive, royalty-free license to use, store, process, and display 
                  Your Content solely for the purpose of providing and improving the Service.
                </p>
                <p className="mb-4">
                  You represent and warrant that you have all necessary rights to grant this license and that Your Content does not 
                  infringe any third-party rights.
                </p>
              </LegalSection>

              <LegalSection id="google-api-services" title="6. Google API Services">
                <p className="mb-4 text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-lg p-4">
                  <strong>Important:</strong> Our use of Google API Services is subject to the{" "}
                  <a 
                    href={LEGAL_CONFIG.googleApiServicesPolicy} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Google API Services User Data Policy
                    <ExternalLink className="inline h-3 w-3 ml-1" />
                  </a>, including the Limited Use requirements.
                </p>
                <p className="mb-4">
                  By using Google authentication, you agree to:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>Comply with Google's Terms of Service and Privacy Policy</li>
                  <li>Allow us to access your Google account information as necessary for authentication</li>
                  <li>Understand that we use Google API Services in accordance with Limited Use requirements</li>
                  <li>Revoke access at any time through your Google Account settings</li>
                </ul>
                <p className="mb-4">
                  We do not use Google user data for advertising purposes or share it with third parties except as described in our Privacy Policy.
                </p>
              </LegalSection>

              <LegalSection id="data-privacy" title="7. Data Privacy and Security">
                <p className="mb-4">
                  Your privacy is important to us. Our collection, use, and protection of your information is governed by our 
                  Privacy Policy, which is incorporated into these Terms by reference.
                </p>
                <p className="mb-4">
                  You agree that:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>You are responsible for the accuracy of information you provide</li>
                  <li>You will comply with applicable data protection laws when using the Service</li>
                  <li>You will not use the Service to process personal data in violation of privacy laws</li>
                  <li>You will implement appropriate security measures for data you access through the Service</li>
                </ul>
                <p className="mb-4">
                  We implement industry-standard security measures, but we cannot guarantee absolute security. You use the Service 
                  at your own risk.
                </p>
              </LegalSection>

              <LegalSection id="service-availability" title="8. Service Availability and Modifications">
                <p className="mb-4">
                  We strive to provide reliable Service availability, but we do not guarantee that the Service will be available 
                  at all times or free from interruptions, errors, or defects.
                </p>
                <p className="mb-4">
                  We reserve the right to:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>Modify, suspend, or discontinue the Service at any time</li>
                  <li>Perform scheduled or emergency maintenance</li>
                  <li>Update features, functionality, or user interfaces</li>
                  <li>Impose usage limits or restrictions</li>
                </ul>
                <p className="mb-4">
                  We will make reasonable efforts to notify you of significant changes or service interruptions, but we are not 
                  obligated to do so.
                </p>
              </LegalSection>

              <LegalSection id="fees-payment" title="9. Fees and Payment">
                <p className="mb-4">
                  Certain features of the Service may be subject to fees. If you purchase a paid subscription or service:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>You agree to pay all applicable fees as described at the time of purchase</li>
                  <li>Fees are billed in advance on a recurring basis (monthly, annually, etc.)</li>
                  <li>All fees are non-refundable unless otherwise stated or required by law</li>
                  <li>You are responsible for any taxes applicable to your purchase</li>
                  <li>We may change our fees with reasonable notice</li>
                  <li>Failure to pay may result in suspension or termination of your account</li>
                </ul>
                <p className="mb-4">
                  <strong className="text-white">Free Trial:</strong> If you are using a free trial, it will automatically convert 
                  to a paid subscription at the end of the trial period unless you cancel before the trial ends.
                </p>
                <p className="mb-4">
                  <strong className="text-white">Refunds:</strong> Refund policies, if applicable, will be specified at the time 
                  of purchase or in a separate refund policy document.
                </p>
              </LegalSection>

              <LegalSection id="disclaimers" title="10. Disclaimers and Limitations of Liability">
                <h3 className="text-xl font-semibold text-white mb-3 mt-6">10.1 Service Provided "As Is"</h3>
                <p className="mb-4">
                  THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, 
                  INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, 
                  OR COURSE OF PERFORMANCE.
                </p>
                <p className="mb-4">
                  We do not warrant that:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>The Service will be uninterrupted, secure, or error-free</li>
                  <li>Defects will be corrected</li>
                  <li>The Service is free of viruses or other harmful components</li>
                  <li>The results obtained from using the Service will be accurate or reliable</li>
                </ul>

                <h3 className="text-xl font-semibold text-white mb-3 mt-6">10.2 Limitation of Liability</h3>
                <p className="mb-4">
                  TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL {LEGAL_CONFIG.companyName.toUpperCase()}, ITS AFFILIATES, 
                  OR THEIR RESPECTIVE OFFICERS, DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, 
                  CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, USE, GOODWILL, OR OTHER 
                  INTANGIBLE LOSSES, ARISING OUT OF OR RELATING TO YOUR USE OF THE SERVICE.
                </p>
                <p className="mb-4">
                  OUR TOTAL LIABILITY FOR ANY CLAIMS ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE 
                  AMOUNT YOU PAID US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR $100, WHICHEVER IS GREATER.
                </p>
                <p className="mb-4">
                  Some jurisdictions do not allow the exclusion or limitation of certain damages, so some of the above limitations 
                  may not apply to you.
                </p>
              </LegalSection>

              <LegalSection id="indemnification" title="11. Indemnification">
                <p className="mb-4">
                  You agree to indemnify, defend, and hold harmless {LEGAL_CONFIG.companyName}, its affiliates, and their respective 
                  officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, costs, 
                  expenses, or fees (including reasonable attorneys' fees) arising out of or relating to:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>Your use of the Service</li>
                  <li>Your violation of these Terms</li>
                  <li>Your violation of any third-party rights</li>
                  <li>Your Content or any content you submit through the Service</li>
                  <li>Your violation of any applicable laws or regulations</li>
                </ul>
                <p className="mb-4">
                  We reserve the right to assume exclusive defense and control of any matter subject to indemnification by you, 
                  and you agree to cooperate with our defense of such claims.
                </p>
              </LegalSection>

              <LegalSection id="third-party-integrations" title="12. Third-Party Integrations">
                <p className="mb-4">
                  The Service may integrate with or provide access to third-party services, including but not limited to WhatsApp, 
                  Google, and other external platforms. Your use of these third-party services is subject to their respective terms 
                  and conditions.
                </p>
                <p className="mb-4">
                  We are not responsible for:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>The availability, accuracy, or reliability of third-party services</li>
                  <li>The content, privacy practices, or terms of third-party services</li>
                  <li>Any issues arising from your use of third-party integrations</li>
                  <li>Changes made by third parties that affect our Service</li>
                </ul>
                <p className="mb-4">
                  You acknowledge that third-party services may change their terms, functionality, or availability at any time, 
                  which may affect your use of the Service.
                </p>
              </LegalSection>

              <LegalSection id="termination" title="13. Termination">
                <h3 className="text-xl font-semibold text-white mb-3 mt-6">13.1 Termination by You</h3>
                <p className="mb-4">
                  You may terminate your account at any time by contacting us or using the account deletion feature in your account settings.
                </p>

                <h3 className="text-xl font-semibold text-white mb-3 mt-6">13.2 Termination by Us</h3>
                <p className="mb-4">
                  We may suspend or terminate your account and access to the Service immediately, without prior notice, if:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>You violate these Terms or our Acceptable Use Policy</li>
                  <li>You engage in fraudulent, illegal, or harmful activities</li>
                  <li>You fail to pay applicable fees</li>
                  <li>We are required to do so by law</li>
                  <li>We discontinue the Service</li>
                </ul>

                <h3 className="text-xl font-semibold text-white mb-3 mt-6">13.3 Effect of Termination</h3>
                <p className="mb-4">
                  Upon termination:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>Your right to access and use the Service will immediately cease</li>
                  <li>We may delete your account and data, subject to our data retention policies</li>
                  <li>You remain responsible for any fees incurred before termination</li>
                  <li>Provisions that by their nature should survive termination will remain in effect</li>
                </ul>
              </LegalSection>

              <LegalSection id="dispute-resolution" title="14. Dispute Resolution">
                <h3 className="text-xl font-semibold text-white mb-3 mt-6">14.1 Governing Law</h3>
                <p className="mb-4">
                  These Terms shall be governed by and construed in accordance with the laws of {LEGAL_CONFIG.jurisdiction}, without 
                  regard to its conflict of law provisions.
                </p>

                <h3 className="text-xl font-semibold text-white mb-3 mt-6">14.2 Dispute Resolution Process</h3>
                <p className="mb-4">
                  If you have a dispute with us, you agree to first contact us at {LEGAL_CONFIG.contactEmail} to attempt to resolve 
                  the dispute informally.
                </p>
                <p className="mb-4">
                  If we cannot resolve the dispute informally within 60 days, you agree that any dispute arising out of or relating 
                  to these Terms or the Service shall be resolved through binding arbitration in accordance with the rules of the 
                  American Arbitration Association, except that either party may seek injunctive relief in any court of competent jurisdiction.
                </p>
                <p className="mb-4">
                  You waive any right to participate in a class-action lawsuit or class-wide arbitration.
                </p>
              </LegalSection>

              <LegalSection id="general-provisions" title="15. General Provisions">
                <h3 className="text-xl font-semibold text-white mb-3 mt-6">15.1 Entire Agreement</h3>
                <p className="mb-4">
                  These Terms, together with our Privacy Policy, constitute the entire agreement between you and {LEGAL_CONFIG.companyName} 
                  regarding the Service and supersede all prior agreements and understandings.
                </p>

                <h3 className="text-xl font-semibold text-white mb-3 mt-6">15.2 Severability</h3>
                <p className="mb-4">
                  If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited or eliminated 
                  to the minimum extent necessary, and the remaining provisions shall remain in full force and effect.
                </p>

                <h3 className="text-xl font-semibold text-white mb-3 mt-6">15.3 Waiver</h3>
                <p className="mb-4">
                  Our failure to enforce any right or provision of these Terms shall not constitute a waiver of such right or provision.
                </p>

                <h3 className="text-xl font-semibold text-white mb-3 mt-6">15.4 Assignment</h3>
                <p className="mb-4">
                  You may not assign or transfer these Terms or your account without our prior written consent. We may assign these Terms 
                  in connection with a merger, acquisition, or sale of assets.
                </p>

                <h3 className="text-xl font-semibold text-white mb-3 mt-6">15.5 Force Majeure</h3>
                <p className="mb-4">
                  We shall not be liable for any failure or delay in performance due to circumstances beyond our reasonable control, 
                  including natural disasters, war, terrorism, labor disputes, or internet failures.
                </p>
              </LegalSection>

              <LegalSection id="contact" title="16. Contact Information">
                <p className="mb-4">
                  If you have questions about these Terms, please contact us:
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

              <LegalSection id="updates" title="17. Updates to Terms">
                <p className="mb-4">
                  We reserve the right to modify these Terms at any time. We will notify you of material changes by:
                </p>
                <ul className="list-disc list-inside space-y-2 mb-6 text-gray-300 ml-4">
                  <li>Posting the updated Terms on this page</li>
                  <li>Updating the "Last Updated" date</li>
                  <li>Sending you an email notification (for significant changes)</li>
                  <li>Displaying a notice on our Service</li>
                </ul>
                <p className="mb-4">
                  Your continued use of the Service after changes become effective constitutes acceptance of the updated Terms. 
                  If you do not agree to the updated Terms, you must stop using the Service and may terminate your account.
                </p>
                <p className="mb-4">
                  We encourage you to review these Terms periodically to stay informed of any updates.
                </p>
              </LegalSection>

              {/* Questions Section */}
              <div className="mt-12 pt-8 border-t border-white/10">
                <div className="glass-card p-6 border-primary/20">
                  <h3 className="text-2xl font-bold text-white mb-4">Questions?</h3>
                  <p className="text-gray-300 mb-4">
                    If you have any questions about these Terms of Service, please don't hesitate to contact us.
                  </p>
                  <div className="flex gap-4">
                    <Link to="/">
                      <Button className="bg-gradient-primary shadow-glow hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)]">
                        Return to Home
                      </Button>
                    </Link>
                    <Link to="/privacy">
                      <Button variant="outline" className="border-white/20 hover:bg-white/10">
                        View Privacy Policy
                      </Button>
                    </Link>
                  </div>
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

export default Terms;

