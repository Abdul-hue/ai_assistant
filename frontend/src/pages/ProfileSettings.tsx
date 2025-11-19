import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { uploadAvatar, deleteAvatar, updateProfile } from '@/lib/api/profile';
import { useAuth } from '@/context/AuthContext.jsx';
import ProfileAvatarMenu from '@/components/ProfileAvatarMenu';
import { Camera, Loader2, Trash2 } from 'lucide-react';

const ProfileSettings = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile, refreshProfile, profileLoading } = useAuth();
  const [formData, setFormData] = useState({
    full_name: '',
    company_name: '',
    phone_number: '',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingAvatar, setDeletingAvatar] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate('/auth');
      }
    };

    checkAuth();
  }, [navigate]);

  useEffect(() => {
    if (!profile) {
      refreshProfile();
      return;
    }

    setFormData({
      full_name: profile.full_name || '',
      company_name: profile.company_name || '',
      phone_number: profile.phone_number || '',
    });
    setPreviewUrl(profile.avatar_url || null);
  }, [profile, refreshProfile]);

  const handleInputChange = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await updateProfile(formData);
      await refreshProfile();
      toast({ title: 'Profile updated', description: 'Your information has been saved.' });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Update failed',
        description: error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      setPreviewUrl(URL.createObjectURL(file));
      await uploadAvatar(file);
      await refreshProfile();
      toast({ title: 'Avatar updated', description: 'Your profile picture has been updated.' });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: error.message,
      });
      setPreviewUrl(profile?.avatar_url || null);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteAvatar = async () => {
    setDeletingAvatar(true);
    try {
      await deleteAvatar();
      await refreshProfile();
      setPreviewUrl(null);
      toast({ title: 'Avatar removed', description: 'Profile picture has been removed.' });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: error.message,
      });
    } finally {
      setDeletingAvatar(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate('/dashboard')}>
            Back to Dashboard
          </Button>
          <ProfileAvatarMenu />
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Profile Settings</h1>
          <p className="text-muted-foreground">Update your personal information and profile picture.</p>
        </div>

        <Card className="shadow-glow">
          <CardHeader>
            <CardTitle>Profile Picture</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="relative">
              <div className="h-24 w-24 rounded-full border overflow-hidden bg-muted flex items-center justify-center text-2xl font-semibold">
                {previewUrl ? (
                  <img src={previewUrl} alt="Avatar preview" className="h-full w-full object-cover" />
                ) : (
                  (profile?.full_name || 'U')
                    .split(' ')
                    .map((part) => part[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()
                )}
              </div>
              <label
                htmlFor="avatar-upload"
                className="absolute -bottom-2 -right-2 bg-primary text-white rounded-full p-2 cursor-pointer shadow-lg"
              >
                <Camera className="h-4 w-4" />
                <input
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
              </label>
            </div>
            <div className="flex-1 space-y-2">
              <p className="text-sm text-muted-foreground">
                Upload a JPG, PNG, GIF, or WEBP image up to 5MB. Your avatar will be visible across the dashboard.
              </p>
              <div className="flex gap-2">
                <Button onClick={() => document.getElementById('avatar-upload')?.click()} disabled={uploading}>
                  {uploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading...
                    </>
                  ) : (
                    'Change avatar'
                  )}
                </Button>
                {previewUrl && (
                  <Button
                    variant="outline"
                    onClick={handleDeleteAvatar}
                    disabled={deletingAvatar}
                    className="text-destructive border-destructive"
                  >
                    {deletingAvatar ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Removing...
                      </>
                    ) : (
                      <>
                        <Trash2 className="mr-2 h-4 w-4" /> Remove
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-glow">
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSave}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={profile?.email || ''} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="full-name">Full Name</Label>
                  <Input
                    id="full-name"
                    value={formData.full_name}
                    onChange={(e) => handleInputChange('full_name', e.target.value)}
                    placeholder="John Doe"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="company-name">Company</Label>
                  <Input
                    id="company-name"
                    value={formData.company_name}
                    onChange={(e) => handleInputChange('company_name', e.target.value)}
                    placeholder="Acme Inc."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone-number">Phone number</Label>
                  <Input
                    id="phone-number"
                    value={formData.phone_number}
                    onChange={(e) => handleInputChange('phone_number', e.target.value)}
                    placeholder="+123456789"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value="Account created via email/password" disabled />
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={saving || profileLoading}>
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                    </>
                  ) : (
                    'Save changes'
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ProfileSettings;

