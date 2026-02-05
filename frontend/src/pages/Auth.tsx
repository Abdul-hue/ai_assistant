import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageSquare, ArrowLeft, Eye, EyeOff, CheckCircle2, XCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { API_URL } from "@/config";
import { CountrySelect } from "@/components/ui/CountrySelect";
import { useAuth } from "@/context/AuthContext";

const Auth = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  // Redirect authenticated users to dashboard
  useEffect(() => {
    // Wait for AuthContext to finish loading before checking
    if (!authLoading && user) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, authLoading, navigate]);

  const [loginData, setLoginData] = useState({
    email: "",
    password: ""
  });

  const [signupData, setSignupData] = useState({
    email: "",
    password: "",
    fullName: "",
    companyName: "",
    phoneNumber: "",
    country: ""
  });

  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);

  // Password matching validation
  const passwordsMatch = confirmPassword !== "" && signupData.password === confirmPassword;
  const passwordsMismatch = confirmPassword !== "" && signupData.password !== confirmPassword;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginData.email,
        password: loginData.password,
      });

      if (error) throw error;

      toast({
        title: "Welcome back!",
        description: "You've successfully logged in.",
      });

      navigate("/dashboard");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Login failed",
        description: error.message || "Invalid email or password",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!acceptedTerms || !acceptedPrivacy) {
      toast({
        variant: "destructive",
        title: "Acceptance required",
        description: "Please accept both the Terms of Service and Privacy Policy to continue.",
      });
      return;
    }

    if (!signupData.country) {
      toast({
        variant: "destructive",
        title: "Country required",
        description: "Please select your country to continue.",
      });
      return;
    }

    if (signupData.password !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Password mismatch",
        description: "Passwords do not match. Please check and try again.",
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/auth/email-signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: 'include', // SECURITY: Send HttpOnly cookies for authentication
        body: JSON.stringify({
          email: signupData.email,
          password: signupData.password,
          fullName: signupData.fullName,
          companyName: signupData.companyName,
          phoneNumber: signupData.phoneNumber,
          country: signupData.country,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "Signup failed");
      }

      // Auto-login after signup (email verification disabled)
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: signupData.email,
        password: signupData.password,
      });

      if (loginError) {
        throw loginError;
      }

      toast({
        title: "Account created!",
        description: "Welcome to WhatsApp AI Assistant. Redirecting to dashboard...",
      });

      navigate("/dashboard");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Signup failed",
        description: error.message || "Could not create account",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading state while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-screen bg-off-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-muted-foreground">Checking authentication...</p>
        </div>
      </div>
    );
  }

  // If user is authenticated, don't render auth form (redirect will happen)
  if (user) {
    return null; // Redirect is handled in useEffect
  }

  return (
    <div className="min-h-screen bg-off-white relative overflow-hidden flex items-center justify-center p-4">
      {/* Animated Background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(37,211,102,0.05),transparent_50%)]"></div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(18,140,126,0.05),transparent_50%)]"></div>
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(247,248,250,0.5)_100%)]"></div>
        <div className="absolute inset-0 bg-[linear-gradient(rgba(37,211,102,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(37,211,102,0.02)_1px,transparent_1px)] bg-[size:50px_50px]"></div>
      </div>

      <div className="w-full max-w-2xl relative z-10 animate-fade-in-up">
        {/* Back Button */}
        <Button
          variant="ghost"
          onClick={() => navigate("/")}
          className="mb-6 text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-300"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Home
        </Button>

        <Link to="/" className="flex items-center justify-center gap-2 mb-10 group">
          <MessageSquare className="h-8 w-8 text-primary group-hover:scale-110 transition-transform duration-300" />
          <span className="text-2xl font-bold text-foreground">
            WhatsApp AI Assistant
          </span>
        </Link>

        <Card className="bg-card border border-border shadow-lg hover:shadow-xl transition-all duration-300">
          <CardHeader className="text-center pb-6">
            <CardTitle className="text-4xl font-bold text-foreground mb-2">Get Started</CardTitle>
            <CardDescription className="text-muted-foreground text-lg">
              Create an account or login to manage your AI agents
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <Tabs defaultValue="login" className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-muted border border-border p-1.5 gap-1.5">
                <TabsTrigger 
                  value="login" 
                  className="w-full data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=inactive]:bg-transparent data-[state=inactive]:text-muted-foreground transition-all duration-300 text-base font-semibold py-2.5 rounded-md"
                >
                  Login
                </TabsTrigger>
                <TabsTrigger 
                  value="signup"
                  className="w-full data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=inactive]:bg-transparent data-[state=inactive]:text-muted-foreground transition-all duration-300 text-base font-semibold py-2.5 rounded-md"
                >
                  Sign Up
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-6">
                <div className="space-y-6">
                  <form onSubmit={handleLogin} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="login-email" className="text-base font-semibold">Email</Label>
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="you@company.com"
                        value={loginData.email}
                        onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
                        required
                        className="text-base h-12"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password" className="text-base font-semibold">Password</Label>
                      <div className="relative">
                        <Input
                          id="login-password"
                          type={showLoginPassword ? "text" : "password"}
                          placeholder="••••••••"
                          value={loginData.password}
                          onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                          required
                          className="pr-10 text-base h-12"
                        />
                        <button
                          type="button"
                          onClick={() => setShowLoginPassword(!showLoginPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-200"
                          tabIndex={-1}
                        >
                          {showLoginPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full bg-gradient-primary shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02] disabled:opacity-50 text-base font-semibold h-12"
                      disabled={isLoading}
                    >
                      {isLoading ? "Logging in..." : "Login"}
                    </Button>
                  </form>
                </div>
              </TabsContent>

              <TabsContent value="signup" className="mt-6">
                <div className="space-y-6">
                  <form onSubmit={handleSignup} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="signup-name" className="text-base font-semibold">Full Name</Label>
                      <Input
                        id="signup-name"
                        placeholder="John Doe"
                        value={signupData.fullName}
                        onChange={(e) => setSignupData({ ...signupData, fullName: e.target.value })}
                        required
                        className="text-base h-12"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-email" className="text-base font-semibold">Email</Label>
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="you@company.com"
                        value={signupData.email}
                        onChange={(e) => setSignupData({ ...signupData, email: e.target.value })}
                        required
                        className="text-base h-12"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-company" className="text-base font-semibold">Company Name</Label>
                      <Input
                        id="signup-company"
                        placeholder="Acme Inc."
                        value={signupData.companyName}
                        onChange={(e) => setSignupData({ ...signupData, companyName: e.target.value })}
                        className="text-base h-12"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-phone" className="text-base font-semibold">Phone Number</Label>
                      <Input
                        id="signup-phone"
                        placeholder="+1234567890"
                        value={signupData.phoneNumber}
                        onChange={(e) => setSignupData({ ...signupData, phoneNumber: e.target.value })}
                        className="text-base h-12"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-country" className="text-base font-semibold">
                        Country <span className="text-destructive">*</span>
                      </Label>
                      <CountrySelect
                        value={signupData.country}
                        onChange={(value) => setSignupData({ ...signupData, country: value })}
                        placeholder="Select your country"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-password" className="text-base font-semibold">Password</Label>
                      <div className="relative">
                        <Input
                          id="signup-password"
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          value={signupData.password}
                          onChange={(e) => setSignupData({ ...signupData, password: e.target.value })}
                          required
                          className="pr-10 text-base h-12"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-200"
                          tabIndex={-1}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-confirm-password" className="text-base font-semibold">Confirm Password</Label>
                      <div className="relative">
                        <Input
                          id="signup-confirm-password"
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder="Re-enter your password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                          className={`pr-10 text-base h-12 ${
                            passwordsMismatch ? "border-destructive focus:border-destructive" : 
                            passwordsMatch ? "border-success focus:border-success" : ""
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-200"
                          tabIndex={-1}
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      {confirmPassword !== "" && (
                        <div className={`flex items-center gap-2 text-sm transition-all duration-200 ${
                          passwordsMatch ? "text-success" : "text-destructive"
                        }`}>
                          {passwordsMatch ? (
                            <>
                              <CheckCircle2 className="h-4 w-4" />
                              <span>Passwords match</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="h-4 w-4" />
                              <span>Passwords do not match</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    
                    {/* Legal Acceptance */}
                    <div className="space-y-4 pt-4 border-t border-border">
                      <div className="flex items-start space-x-3">
                        <Checkbox
                          id="terms-checkbox"
                          checked={acceptedTerms}
                          onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
                          className="mt-1"
                        />
                        <Label 
                          htmlFor="terms-checkbox" 
                          className="text-base text-muted-foreground leading-relaxed cursor-pointer"
                        >
                          I agree to the{" "}
                          <Link to="/terms" className="text-primary hover:underline" target="_blank">
                            Terms of Service
                          </Link>
                        </Label>
                      </div>
                      <div className="flex items-start space-x-3">
                        <Checkbox
                          id="privacy-checkbox"
                          checked={acceptedPrivacy}
                          onCheckedChange={(checked) => setAcceptedPrivacy(checked === true)}
                          className="mt-1"
                        />
                        <Label 
                          htmlFor="privacy-checkbox" 
                          className="text-base text-muted-foreground leading-relaxed cursor-pointer"
                        >
                          I have read and agree to the{" "}
                          <Link to="/privacy" className="text-primary hover:underline" target="_blank">
                            Privacy Policy
                          </Link>
                        </Label>
                      </div>
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full bg-gradient-primary shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02] disabled:opacity-50 text-base font-semibold h-12"
                      disabled={isLoading || !acceptedTerms || !acceptedPrivacy || !passwordsMatch || confirmPassword === "" || signupData.password === ""}
                    >
                      {isLoading ? "Creating account..." : "Create Account"}
                    </Button>
                  </form>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Auth;
