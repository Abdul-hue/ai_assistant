import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const ResetPassword = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    // Check if we have a valid session with password recovery
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({
          variant: "destructive",
          title: "Invalid reset link",
          description: "This password reset link is invalid or has expired. Please request a new one.",
        });
        navigate("/forgot-password");
      }
    };
    checkSession();
  }, [navigate, toast]);

  const validatePasswords = () => {
    if (password.length < 6) {
      setPasswordError("Password must be at least 6 characters");
      return false;
    }
    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return false;
    }
    setPasswordError("");
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validatePasswords()) {
      return;
    }

    setIsLoading(true);

    try {
      console.log("🔄 Updating password...");

      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) {
        console.error("❌ Password update error:", error.message);
        throw error;
      }

      console.log("✅ Password updated successfully");
      setSuccess(true);

      toast({
        title: "Password updated",
        description: "Your password has been successfully updated.",
      });

      // Auto-redirect to login after 2 seconds
      setTimeout(() => {
        navigate("/auth");
      }, 2000);
    } catch (error: any) {
      console.error("❌ Password update error:", error.message);
      toast({
        variant: "destructive",
        title: "Failed to update password",
        description: error.message || "An error occurred. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center justify-center gap-2 mb-8">
          <MessageSquare className="h-8 w-8 text-primary" />
          <span className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            WhatsApp AI Assistant
          </span>
        </Link>

        <Card className="shadow-glow border-2">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Set New Password</CardTitle>
            <CardDescription>
              Enter your new password below
            </CardDescription>
          </CardHeader>
          <CardContent>
            {success ? (
              <div className="space-y-4">
                <div className="bg-[#D1FAE5] text-[#065F46] p-4 rounded-lg">
                  <p className="text-sm font-medium">
                    Your password has been successfully updated. Redirecting to login...
                  </p>
                </div>
                <Link to="/auth">
                  <Button className="w-full bg-gradient-primary shadow-glow">
                    Go to Login
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (passwordError) validatePasswords();
                    }}
                    required
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (passwordError) validatePasswords();
                    }}
                    required
                    disabled={isLoading}
                  />
                </div>
                {passwordError && (
                  <div className="bg-[#FEE2E2] text-[#991B1B] p-3 rounded-lg">
                    <p className="text-sm">{passwordError}</p>
                  </div>
                )}
                <p className="text-xs text-[#6B7280]">Minimum 6 characters</p>
                <Button
                  type="submit"
                  className="w-full bg-gradient-primary shadow-glow"
                  disabled={isLoading}
                >
                  {isLoading ? "Updating..." : "Update Password"}
                </Button>
                <div className="text-center">
                  <Link
                    to="/auth"
                    className="text-sm text-[#6B7280] hover:text-[#4F46E5] transition-colors"
                  >
                    Back to Login
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ResetPassword;

