import { Button } from "@/components/ui/button";
import { MessageSquare, Zap, Shield, TrendingUp, Bot, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const Index = () => {
  const features = [
    {
      icon: <Bot className="h-8 w-8" />,
      title: "AI-Powered Agents",
      description: "Create intelligent WhatsApp agents that understand and respond to your customers naturally"
    },
    {
      icon: <Zap className="h-8 w-8" />,
      title: "Instant Setup",
      description: "Connect your WhatsApp in seconds with QR code scanning. No technical knowledge required"
    },
    {
      icon: <MessageSquare className="h-8 w-8" />,
      title: "Smart Conversations",
      description: "Handle multiple conversations simultaneously with context-aware AI responses"
    },
    {
      icon: <Shield className="h-8 w-8" />,
      title: "Enterprise Security",
      description: "Bank-level encryption and secure data handling for all your conversations"
    },
    {
      icon: <TrendingUp className="h-8 w-8" />,
      title: "Advanced Analytics",
      description: "Track performance, response times, and customer satisfaction in real-time"
    },
    {
      icon: <Zap className="h-8 w-8" />,
      title: "Seamless Integration",
      description: "Connect to your ERP, CRM, and other business tools effortlessly"
    }
  ];

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      {/* Animated Background Pattern */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(59,130,246,0.1),transparent_50%)]"></div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(139,92,246,0.1),transparent_50%)]"></div>
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(0,0,0,0.5)_100%)]"></div>
        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px]"></div>
      </div>

      {/* Navigation */}
      <nav className="relative z-50 border-b border-white/10 bg-black/80 backdrop-blur-xl supports-[backdrop-filter]:bg-black/60">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-6 w-6 text-primary animate-pulse-glow" />
              <span className="text-xl font-bold gradient-text">
                WhatsApp AI Assistant
              </span>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/auth">
                <Button variant="ghost" className="hover:bg-white/10 transition-all duration-300">
                  Login
                </Button>
              </Link>
              <Link to="/auth">
                <Button className="bg-gradient-primary shadow-glow hover:shadow-[0_0_40px_hsl(var(--primary)/0.6)] transition-all duration-300 hover:scale-105">
                  Get Started
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 container mx-auto px-4 pt-32 pb-24 text-center">
        <div className="max-w-5xl mx-auto space-y-10 animate-fade-in-up">
          <h1 className="text-6xl md:text-8xl font-bold tracking-tight leading-tight">
            <span className="text-white">Transform Your Business</span>
            <span className="block mt-4 gradient-text">
              with AI-Powered WhatsApp Agents
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-gray-400 max-w-3xl mx-auto leading-relaxed">
            Automate customer conversations, boost productivity, and scale your business 
            with intelligent WhatsApp agents that work 24/7
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-6">
            <Link to="/auth">
              <Button 
                size="lg" 
                className="bg-gradient-primary shadow-glow text-lg px-10 py-6 hover:shadow-[0_0_50px_hsl(var(--primary)/0.6)] transition-all duration-300 hover:scale-105 animate-pulse-glow"
              >
                Start Free Trial
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Button 
              size="lg" 
              variant="outline" 
              className="text-lg px-10 py-6 border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/30 transition-all duration-300"
            >
              Watch Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="relative z-10 container mx-auto px-4 py-24">
        <div className="text-center mb-20 animate-fade-in-up">
          <h2 className="text-4xl md:text-5xl font-bold mb-6 text-white">
            Everything You Need to Succeed
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Powerful features designed to help you automate, scale, and grow your business
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {features.map((feature, index) => (
            <div 
              key={index}
              className="glass-card p-8 hover:scale-105 transition-all duration-300 hover:border-primary/50 group animate-fade-in-up"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <div className="text-primary mb-6 group-hover:scale-110 transition-transform duration-300">
                {feature.icon}
              </div>
              <h3 className="text-xl font-semibold mb-3 text-white">{feature.title}</h3>
              <p className="text-gray-400 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 container mx-auto px-4 py-24">
        <div className="glass-card p-12 md:p-16 text-center shadow-glow hover:shadow-[0_0_50px_hsl(var(--primary)/0.4)] transition-all duration-500 max-w-4xl mx-auto">
          <h2 className="text-4xl md:text-6xl font-bold text-white mb-6">
            Ready to Get Started?
          </h2>
          <p className="text-xl text-gray-300 mb-10 max-w-2xl mx-auto">
            Join thousands of businesses already using AI to transform their customer communications
          </p>
          <Link to="/auth">
            <Button 
              size="lg" 
              className="bg-gradient-primary shadow-glow text-lg px-10 py-6 hover:shadow-[0_0_50px_hsl(var(--primary)/0.6)] transition-all duration-300 hover:scale-105"
            >
              Create Your First Agent
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 py-12 bg-black/80 backdrop-blur-xl">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare className="h-6 w-6 text-primary" />
                <span className="text-xl font-bold gradient-text">
                  WhatsApp AI Assistant
                </span>
              </div>
              <p className="text-gray-400 text-sm">
                Transform your business with AI-powered WhatsApp agents that work 24/7.
              </p>
            </div>
            <div>
              <h3 className="text-white font-semibold mb-4">Legal</h3>
              <ul className="space-y-2">
                <li>
                  <Link to="/privacy" className="text-gray-400 hover:text-primary transition-colors text-sm">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link to="/terms" className="text-gray-400 hover:text-primary transition-colors text-sm">
                    Terms of Service
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-white font-semibold mb-4">Company</h3>
              <ul className="space-y-2">
                <li>
                  <Link to="/" className="text-gray-400 hover:text-primary transition-colors text-sm">
                    Home
                  </Link>
                </li>
                <li>
                  <Link to="/auth" className="text-gray-400 hover:text-primary transition-colors text-sm">
                    Sign Up
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/10 pt-8 text-center text-gray-400 text-sm">
            <p>&copy; 2024 WhatsApp AI Assistant. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
