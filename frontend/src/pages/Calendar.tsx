import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Calendar as CalendarIcon, Plus, Trash2, Loader2, AlertCircle, MessageSquare, LayoutDashboard, Settings, Home } from "lucide-react";
import ProfileAvatarMenu from "@/components/ProfileAvatarMenu";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from "date-fns";

type SupabaseMeeting = {
  id: number;
  title: string;
  purpose: string;
  date_time: string;
  location: string | null;
  status: string | null;
  notes: string | null;
  contact_name: string | null;
  contact_phone: string | null;
};

type CalendarMeeting = SupabaseMeeting & {
  parsedDate: Date;
};

const Calendar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [meetings, setMeetings] = useState<CalendarMeeting[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showEventDialog, setShowEventDialog] = useState(false);
  const [viewMeeting, setViewMeeting] = useState<CalendarMeeting | null>(null);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meetingForm, setMeetingForm] = useState({
    title: "",
    purpose: "",
    time: "",
    location: "",
    notes: "",
    contactName: "",
    contactPhone: "",
  });

  const isActive = (path: string) => location.pathname === path;

  // Initialize authentication
  useEffect(() => {
    const init = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) {
        navigate("/auth");
        return;
      }
      setCurrentUserId(session.user.id);
        setIsLoading(false);
      } catch (err) {
        console.error("Error initializing auth:", err);
        setError("Failed to authenticate. Please try again.");
        setIsLoading(false);
      }
    };

    init();
  }, [navigate]);

  // Fetch meetings and set up real-time subscription
  useEffect(() => {
    if (!currentUserId) return;

    let subscription: ReturnType<typeof supabase.channel> | null = null;

  const fetchMeetings = async () => {
      try {
        setIsLoading(true);
        setError(null);

    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const startIso = monthStart.toISOString();
    const endIso = monthEnd.toISOString();

        const { data, error: fetchError } = await supabase
      .from("meetings")
          .select("id, title, purpose, date_time, location, status, notes, contact_name, contact_phone, created_by_phone, scheduler_phone, created_at")
          .eq("user_id", currentUserId) // CRITICAL: Only filter by user_id
          .eq("status", "scheduled") // Only show scheduled meetings
      .gte("date_time", startIso)
      .lte("date_time", endIso)
          .order("date_time", { ascending: true });

        if (fetchError) {
          throw fetchError;
    }

    const normalized = (data || [])
      .map((meeting: SupabaseMeeting) => {
        const parsedDate = parseMeetingDate(meeting.date_time);
        if (!parsedDate) {
          console.warn("[Calendar] Unable to parse meeting date_time:", meeting);
          return null;
        }
        return { ...meeting, parsedDate };
      })
      .filter((meeting): meeting is CalendarMeeting => Boolean(meeting && meeting.parsedDate))
      .filter((meeting) => meeting.parsedDate >= monthStart && meeting.parsedDate <= monthEnd)
      .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());

    setMeetings(normalized);
        setError(null);
      } catch (err: any) {
        console.error("Error fetching meetings:", err);
        setError(err.message || "Failed to load meetings");
        toast({
          variant: "destructive",
          title: "Error fetching meetings",
          description: err.message || "Please try again later.",
        });
      } finally {
        setIsLoading(false);
      }
    };

    // Initial fetch
    fetchMeetings();

    // Set up real-time subscription
    subscription = supabase
      .channel(`meetings-changes-${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "meetings",
          filter: `user_id=eq.${currentUserId}`, // Only subscribe to user's meetings
        },
        (payload) => {
          console.log("[Calendar] Real-time update:", payload);
          // Refetch meetings when changes occur
          fetchMeetings();
        }
      )
      .subscribe();

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [currentDate, currentUserId, toast]);

  const parseMeetingDate = (value: string): Date | null => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      console.warn("[Calendar] Unable to parse meeting date_time:", value);
      return null;
    }
    return date;
  };


  const handleCreateMeeting = async () => {
    if (!selectedDate || !meetingForm.title || !meetingForm.purpose || !meetingForm.time) {
      toast({
        variant: "destructive",
        title: "Missing information",
        description: "Title, purpose, and time are required.",
      });
      return;
    }

    const meetingDateTime = new Date(`${format(selectedDate, "yyyy-MM-dd")}T${meetingForm.time}`);
    if (Number.isNaN(meetingDateTime.getTime())) {
      toast({
        variant: "destructive",
        title: "Invalid time",
        description: "Please provide a valid time for the meeting.",
      });
      return;
    }

    const formattedDateTime = format(meetingDateTime, "yyyy-MM-dd HH:mm:ss");

    if (!currentUserId && !currentUserPhone) {
      toast({
        variant: "destructive",
        title: "Unauthorized",
        description: "You must be logged in to schedule meetings.",
      });
      return;
    }

    if (!currentUserId) {
      toast({
        variant: "destructive",
        title: "Unauthorized",
        description: "You must be logged in to schedule meetings.",
      });
      return;
    }

    const payload = {
      title: meetingForm.title,
      purpose: meetingForm.purpose,
      date_time: formattedDateTime,
      location: meetingForm.location || null,
      notes: meetingForm.notes || null,
      contact_name: meetingForm.contactName || null,
      contact_phone: meetingForm.contactPhone || null,
      status: "scheduled",
      user_id: currentUserId, // CRITICAL: Always set user_id
      created_by_phone: "", // Set empty string as default
    };

    const { error } = await supabase.from("meetings").insert(payload);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error scheduling meeting",
        description: error.message,
      });
      return;
    }

    toast({
      title: "Meeting scheduled!",
      description: "Your meeting has been added to the calendar.",
    });

    setShowEventDialog(false);
    setMeetingForm({ title: "", purpose: "", time: "", location: "", notes: "", contactName: "", contactPhone: "" });
    // Real-time subscription will automatically update the calendar
  };

  const handleDeleteMeeting = async (meetingId: number) => {
    if (!currentUserId) {
      toast({
        variant: "destructive",
        title: "Unauthorized",
        description: "You must be logged in to delete meetings.",
      });
      return;
    }

    // Confirm deletion
    if (!confirm("Are you sure you want to delete this meeting? This action cannot be undone.")) {
      return;
    }

    try {
      // CRITICAL: Only delete if user_id matches (security)
      const { data, error } = await supabase
        .from("meetings")
        .delete()
        .eq("id", meetingId)
        .eq("user_id", currentUserId) // Ensure user can only delete their own meetings
        .select(); // Select to verify deletion

      if (error) {
        console.error("[Calendar] Error deleting meeting:", error);
        toast({
          variant: "destructive",
          title: "Error deleting meeting",
          description: error.message || "Failed to delete the meeting. Please try again.",
        });
        return;
      }

      // Manually remove from local state for immediate UI update
      setMeetings((prev) => prev.filter((meeting) => meeting.id !== meetingId));

    toast({
      title: "Meeting removed",
      description: "The meeting has been removed from your calendar.",
    });

      // Force a refetch to ensure consistency (real-time subscription will also update)
      // Trigger a refetch by updating currentDate slightly to force useEffect
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      
      // Refetch meetings manually
      const { data: refreshedData, error: fetchError } = await supabase
        .from("meetings")
        .select("id, title, purpose, date_time, location, status, notes, contact_name, contact_phone, created_by_phone, scheduler_phone, created_at")
        .eq("user_id", currentUserId)
        .eq("status", "scheduled")
        .gte("date_time", monthStart.toISOString())
        .lte("date_time", monthEnd.toISOString())
        .order("date_time", { ascending: true });

      if (!fetchError && refreshedData) {
        const normalized = (refreshedData || [])
          .map((meeting: SupabaseMeeting) => {
            const parsedDate = parseMeetingDate(meeting.date_time);
            if (!parsedDate) {
              console.warn("[Calendar] Unable to parse meeting date_time:", meeting);
              return null;
            }
            return { ...meeting, parsedDate };
          })
          .filter((meeting): meeting is CalendarMeeting => Boolean(meeting && meeting.parsedDate))
          .filter((meeting) => meeting.parsedDate >= monthStart && meeting.parsedDate <= monthEnd)
          .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());

        setMeetings(normalized);
      }
    } catch (err: any) {
      console.error("[Calendar] Unexpected error deleting meeting:", err);
      toast({
        variant: "destructive",
        title: "Error deleting meeting",
        description: err.message || "An unexpected error occurred. Please try again.",
      });
    }
  };

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentDate),
    end: endOfMonth(currentDate),
  });

  const getMeetingsForDay = (day: Date) => {
    return meetings.filter(meeting => 
      isSameDay(meeting.parsedDate, day)
    );
  };

  // Loading state
  if (isLoading && !currentUserId) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-gray-400">Loading calendar...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && meetings.length === 0) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">Failed to Load Meetings</h3>
          <p className="text-gray-400 mb-6">{error}</p>
          <Button onClick={() => window.location.reload()} className="bg-gradient-primary">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex">
      {/* Sidebar */}
      <aside className="w-64 bg-[#0a0a0a] border-r border-white/10 flex flex-col fixed h-screen z-40">
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-2 mb-6">
            <MessageSquare className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold gradient-text">
              WhatsApp AI
            </span>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/dashboard") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/dashboard")}
          >
            <LayoutDashboard className="h-5 w-5" />
            Dashboard
          </Button>
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/create-agent") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/create-agent")}
          >
            <Plus className="h-5 w-5" />
            Create Agent
          </Button>
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/calendar") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/calendar")}
          >
            <CalendarIcon className="h-5 w-5" />
            Calendar
          </Button>
          <Button
            variant="ghost"
            className={`w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 ${
              isActive("/profile") ? "bg-primary/20 text-primary border-l-2 border-primary" : "text-gray-400"
            }`}
            onClick={() => navigate("/profile")}
          >
            <Settings className="h-5 w-5" />
            Settings
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 hover:bg-white/10 transition-all duration-300 text-gray-400"
            onClick={() => navigate("/")}
          >
            <Home className="h-5 w-5" />
            Home
          </Button>
        </nav>

        <div className="p-4 border-t border-white/10">
          <ProfileAvatarMenu />
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 ml-64">
        <header className="border-b border-white/10 bg-black/80 backdrop-blur-xl sticky top-0 z-30">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
          <div>
                <h1 className="text-2xl font-bold text-white mb-1">My Calendar</h1>
                <p className="text-gray-400 text-sm">
              Manage your schedule and events
            </p>
              </div>
              <Button
                onClick={() => {
                  setSelectedDate(new Date());
                  setShowEventDialog(true);
                }}
                className="bg-gradient-primary shadow-glow hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)] transition-all duration-300 hover:scale-105"
              >
                <Plus className="mr-2 h-4 w-4" />
                Schedule Meeting
              </Button>
            </div>
          </div>
        </header>

        <div className="p-6">

          {/* Empty State */}
          {meetings.length === 0 && !isLoading && (
            <Card className="glass-card text-center py-16 border-dashed">
              <CardContent className="space-y-6">
                <CalendarIcon className="h-20 w-20 mx-auto text-gray-600" />
                <div>
                  <h3 className="text-2xl font-semibold mb-2 text-white">No Scheduled Meetings</h3>
                  <p className="text-gray-400 mb-6">
                    Your scheduled meetings will appear here
                  </p>
                  <Button
                    onClick={() => {
                      setSelectedDate(new Date());
                      setShowEventDialog(true);
                    }}
                    className="bg-gradient-primary shadow-glow hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)] transition-all duration-300 hover:scale-105"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Schedule Your First Meeting
                  </Button>
        </div>
              </CardContent>
            </Card>
          )}

          {/* Calendar */}
          {meetings.length > 0 && (
            <Card className="glass-card shadow-glow border-white/10">
          <CardHeader>
            <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-white">
                    <CalendarIcon className="h-5 w-5 text-primary" />
                {format(currentDate, "MMMM yyyy")}
              </CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentDate(subMonths(currentDate, 1))}
                      className="border-white/20 hover:bg-white/10 text-gray-300"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentDate(new Date())}
                      className="border-white/20 hover:bg-white/10 text-gray-300"
                >
                  Today
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentDate(addMonths(currentDate, 1))}
                      className="border-white/20 hover:bg-white/10 text-gray-300"
                >
                  Next
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-2 mb-4">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                    <div key={day} className="text-center font-semibold text-sm text-gray-300">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-2">
              {daysInMonth.map(day => {
                const dayMeetings = getMeetingsForDay(day);
                const isToday = isSameDay(day, new Date());
                
                return (
                  <div
                    key={day.toString()}
                        className={`min-h-[100px] rounded-lg border p-2 cursor-pointer hover:bg-white/5 transition-all duration-300 ${
                          isToday ? "border-primary bg-primary/10" : "border-white/10"
                        } ${!isSameMonth(day, currentDate) ? "opacity-30" : ""}`}
                    onClick={() => {
                      setSelectedDate(day);
                      setShowEventDialog(true);
                    }}
                  >
                        <div className={`font-semibold text-sm mb-1 ${isToday ? "text-primary" : "text-white"}`}>
                      {format(day, "d")}
                    </div>
                    <div className="space-y-1">
                      {dayMeetings.map(meeting => (
                        <div
                          key={meeting.id}
                              className="relative bg-primary/20 border border-primary/30 rounded px-2 py-1 text-xs leading-tight group hover:bg-primary/30 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewMeeting(meeting);
                            setShowViewDialog(true);
                          }}
                          title={`${meeting.title}\n${meeting.purpose}\n${meeting.location ?? ""}\n${meeting.contact_name ?? ""} ${meeting.contact_phone ?? ""}`}
                        >
                              <div className="font-semibold truncate text-white">
                            {format(meeting.parsedDate, "HH:mm")} · {meeting.title}
                          </div>
                              <div className="text-[11px] text-gray-300 truncate">
                            {meeting.purpose}
                          </div>
                          {meeting.location && (
                                <div className="text-[11px] text-gray-400 truncate">
                              📍 {meeting.location}
                            </div>
                          )}
                          {(meeting.contact_name || meeting.contact_phone) && (
                                <div className="text-[11px] text-gray-400 truncate">
                              👤 {meeting.contact_name || "N/A"}
                              {meeting.contact_phone && ` • ${meeting.contact_phone}`}
                            </div>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                                className="absolute top-1 right-1 h-4 w-4 p-0 opacity-0 group-hover:opacity-100 hover:bg-red-500/20"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteMeeting(meeting.id);
                            }}
                          >
                                <Trash2 className="h-3 w-3 text-red-400" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
          )}

        <Dialog open={showEventDialog} onOpenChange={setShowEventDialog}>
          <DialogContent className="glass-card border-white/10 bg-[#0a0a0a] text-white">
            <DialogHeader>
              <DialogTitle className="text-white">
                Schedule Meeting - {selectedDate && format(selectedDate, "MMMM d, yyyy")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="meeting-title" className="text-gray-300">Title *</Label>
                <Input
                  id="meeting-title"
                  placeholder="Meeting title"
                  value={meetingForm.title}
                  onChange={(e) => setMeetingForm({ ...meetingForm, title: e.target.value })}
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="meeting-purpose" className="text-gray-300">Purpose *</Label>
                <Textarea
                  id="meeting-purpose"
                  placeholder="Describe the purpose of this meeting"
                  rows={3}
                  value={meetingForm.purpose}
                  onChange={(e) => setMeetingForm({ ...meetingForm, purpose: e.target.value })}
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="meeting-time" className="text-gray-300">Time *</Label>
                  <Input
                    id="meeting-time"
                    type="time"
                    value={meetingForm.time}
                    onChange={(e) => setMeetingForm({ ...meetingForm, time: e.target.value })}
                    className="bg-white/5 border-white/10 text-white focus:border-primary focus:ring-primary/50"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="meeting-location" className="text-gray-300">Location</Label>
                  <Input
                    id="meeting-location"
                    placeholder="Optional location"
                    value={meetingForm.location}
                    onChange={(e) => setMeetingForm({ ...meetingForm, location: e.target.value })}
                    className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="meeting-notes" className="text-gray-300">Notes</Label>
                <Textarea
                  id="meeting-notes"
                  placeholder="Additional notes (optional)"
                  rows={2}
                  value={meetingForm.notes}
                  onChange={(e) => setMeetingForm({ ...meetingForm, notes: e.target.value })}
                  className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="meeting-contact-name" className="text-gray-300">Contact Name</Label>
                  <Input
                    id="meeting-contact-name"
                    placeholder="Point of contact"
                    value={meetingForm.contactName}
                    onChange={(e) => setMeetingForm({ ...meetingForm, contactName: e.target.value })}
                    className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="meeting-contact-phone" className="text-gray-300">Contact Phone</Label>
                  <Input
                    id="meeting-contact-phone"
                    placeholder="Contact phone"
                    value={meetingForm.contactPhone}
                    onChange={(e) => setMeetingForm({ ...meetingForm, contactPhone: e.target.value })}
                    className="bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-primary focus:ring-primary/50"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowEventDialog(false);
                    setMeetingForm({ title: "", purpose: "", time: "", location: "", notes: "", contactName: "", contactPhone: "" });
                  }}
                  className="border-white/20 hover:bg-white/10 text-gray-300"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateMeeting}
                  className="bg-gradient-primary shadow-glow hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)]"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Schedule Meeting
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={showViewDialog && !!viewMeeting}
          onOpenChange={(open) => {
            setShowViewDialog(open);
            if (!open) {
              setViewMeeting(null);
            }
          }}
        >
          <DialogContent className="glass-card border-white/10 bg-[#0a0a0a] text-white">
            <DialogHeader>
              <DialogTitle className="text-white">
                Meeting Details {viewMeeting ? `- ${format(viewMeeting.parsedDate, "MMMM d, yyyy")}` : ""}
              </DialogTitle>
            </DialogHeader>
            {viewMeeting && (
              <div className="space-y-4 text-sm">
                <div>
                  <Label className="text-xs uppercase text-gray-400 mb-1 block">Title</Label>
                  <div className="font-semibold text-white">{viewMeeting.title}</div>
                </div>
                <div>
                  <Label className="text-xs uppercase text-gray-400 mb-1 block">Purpose</Label>
                  <div className="text-gray-300">{viewMeeting.purpose}</div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs uppercase text-gray-400 mb-1 block">Date</Label>
                    <div className="text-white">{format(viewMeeting.parsedDate, "MMMM d, yyyy")}</div>
                  </div>
                  <div>
                    <Label className="text-xs uppercase text-gray-400 mb-1 block">Time</Label>
                    <div className="text-white">{format(viewMeeting.parsedDate, "HH:mm")}</div>
                  </div>
                </div>
                {viewMeeting.location && (
                  <div>
                    <Label className="text-xs uppercase text-gray-400 mb-1 block">Location</Label>
                    <div className="text-gray-300">📍 {viewMeeting.location}</div>
                  </div>
                )}
                {(viewMeeting.contact_name || viewMeeting.contact_phone) && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs uppercase text-gray-400 mb-1 block">Contact Name</Label>
                      <div className="text-white">{viewMeeting.contact_name || "—"}</div>
                    </div>
                    <div>
                      <Label className="text-xs uppercase text-gray-400 mb-1 block">Contact Phone</Label>
                      <div className="text-white">{viewMeeting.contact_phone || "—"}</div>
                    </div>
                  </div>
                )}
                {viewMeeting.notes && (
                  <div>
                    <Label className="text-xs uppercase text-gray-400 mb-1 block">Notes</Label>
                    <div className="text-gray-300">{viewMeeting.notes}</div>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-4 border-t border-white/10">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowViewDialog(false);
                      setViewMeeting(null);
                    }}
                    className="border-white/20 hover:bg-white/10 text-gray-300"
                  >
                    Close
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (viewMeeting) {
                        handleDeleteMeeting(viewMeeting.id);
                        setShowViewDialog(false);
                        setViewMeeting(null);
                      }
                    }}
                    className="hover:bg-red-600"
                  >
                    Delete Meeting
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
        </div>
      </div>
    </div>
  );
};

export default Calendar;
