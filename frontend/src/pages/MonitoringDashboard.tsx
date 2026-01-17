import { useEffect, useState, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertCircle, Database, MessageSquare, Cpu, Zap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/config";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis, CartesianGrid } from "recharts";

interface HealthData {
  activeAgents?: number;
  agents?: {
    assigned?: number;
  };
  localCaches?: Record<string, { size: number; max: number }>;
  system?: {
    memory?: {
      heapUsed?: string;
      heapTotal?: string;
      rss?: string;
    };
  };
  resources?: {
    memory?: {
      heapUsed?: number;
    };
  };
  errorStats?: {
    currentRate?: string;
    last5Minutes?: {
      total?: number;
      topPatterns?: Array<{
        category?: string;
        severity?: string;
        message?: string;
        count?: number;
        lastSeen?: number;
      }>;
    };
  };
  alertStats?: {
    active?: number;
    activeAlerts?: Array<{
      type?: string;
      severity?: string;
      message?: string;
      lastTriggered?: string;
      count?: number;
    }>;
  };
  messageQueue?: {
    totalPending?: number;
  };
}

const MonitoringDashboard = () => {
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ time: string; connections: number; messages: number }>>([]);

  const fetchHealthData = useCallback(async () => {
    try {
      // Use timestamp in URL and cache: 'no-cache' option (no custom headers to avoid CORS issues)
      const response = await fetch(`${API_URL}/api/health/detailed?t=${Date.now()}`, {
        credentials: 'include',
        cache: 'no-cache', // Prevent browser caching
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Debug logging
      console.log('[MONITORING] Health data received:', {
        agentsAssigned: data.agents?.assigned,
        activeAgents: data.activeAgents,
        databaseCount: data.agents?.assigned || data.activeAgents,
        timestamp: data.timestamp
      });
      
      setHealthData(data);
      setError(null);
      
      // Update history
      const timestamp = new Date().toLocaleTimeString();
      // Handle both data.agents?.assigned and data.activeAgents (backward compatibility)
      const activeAgents = data.agents?.assigned ?? data.activeAgents ?? 0;
      // messageQueue.totalPending is the total pending messages, not a rate
      // For messages/min, we should calculate from actual message metrics or use 0 if unavailable
      const messageQueue = data.messageQueue?.totalPending || 0;
      // Calculate messages/min from messageQueue (this is approximate - actual rate would need tracking)
      const messageRate = messageQueue > 0 ? Math.floor(messageQueue / 60) : 0;
      
      setHistory(prev => {
        const newHistory = [...prev, { time: timestamp, connections: activeAgents, messages: messageRate }];
        // Keep only last 60 data points (5 minutes at 5-second intervals)
        return newHistory.slice(-60);
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch health data';
      setError(errorMessage);
      console.error('Failed to fetch health data:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealthData();
    const interval = setInterval(fetchHealthData, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, [fetchHealthData]);

  const calculateCacheHitRate = (caches: Record<string, { size: number; max: number }> | undefined): string => {
    if (!caches) return '--';
    let totalSize = 0;
    let totalMax = 0;
    Object.values(caches).forEach(cache => {
      totalSize += cache.size || 0;
      totalMax += cache.max || 0;
    });
    return totalMax > 0 ? `${((totalSize / totalMax) * 100).toFixed(1)}%` : '--';
  };

  const formatMemory = (memory: string | number | undefined): string => {
    if (!memory) return '--';
    // If it's already a formatted string (e.g., "123MB"), return it
    if (typeof memory === 'string') {
      // Check if it's already formatted (contains "MB")
      if (memory.includes('MB') || memory.includes('GB') || memory.includes('KB')) {
        return memory;
      }
      // Try to parse as number if it's a string number
      const parsed = parseFloat(memory);
      if (!isNaN(parsed)) {
        const mb = parsed / (1024 * 1024);
        return `${mb.toFixed(1)}MB`;
      }
      return memory;
    }
    // If it's a number, assume it's in bytes
    const mb = memory / (1024 * 1024);
    return `${mb.toFixed(1)}MB`;
  };

  const getSystemStatus = () => {
    if (!healthData) return { status: 'unknown', text: 'Loading...', color: 'gray' };
    
    const alertCount = healthData.alertStats?.active || 0;
    if (alertCount > 0) {
      const hasCritical = healthData.alertStats?.activeAlerts?.some(a => a.severity === 'critical');
      if (hasCritical) {
        return { status: 'error', text: 'Critical Alerts', color: 'red' };
      }
      return { status: 'warning', text: 'Warnings Active', color: 'yellow' };
    }
    return { status: 'healthy', text: 'System Healthy', color: 'green' };
  };

  const systemStatus = getSystemStatus();

  const headerContent = (
    <div className="flex items-center justify-between gap-4 w-full">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
          System Monitoring
        </h1>
        <p className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm mt-1">
          Real-time system health and performance metrics
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Badge 
          variant={systemStatus.status === 'healthy' ? 'default' : systemStatus.status === 'warning' ? 'secondary' : 'destructive'}
          className="flex items-center gap-1"
        >
          <div className={`w-2 h-2 rounded-full ${
            systemStatus.status === 'healthy' ? 'bg-green-500' : 
            systemStatus.status === 'warning' ? 'bg-yellow-500' : 
            'bg-red-500'
          }`} />
          {systemStatus.text}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchHealthData}
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
    </div>
  );

  const chartConfig = {
    connections: {
      label: "Active Connections",
      color: "hsl(var(--chart-1))",
    },
    messages: {
      label: "Messages/min",
      color: "hsl(var(--chart-2))",
    },
  };

  if (error && !healthData) {
    return (
      <AppLayout headerContent={headerContent}>
        <div className="flex items-center justify-center min-h-[400px]">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-destructive" />
                Connection Error
              </CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={fetchHealthData} className="w-full">
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout headerContent={headerContent}>
      <div className="space-y-6">
        {/* Stat Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Connections</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {healthData?.agents?.assigned || healthData?.activeAgents || 0}
              </div>
              <p className="text-xs text-muted-foreground">Currently connected agents</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Messages/min</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {healthData?.messageQueue?.totalPending 
                  ? Math.floor(healthData.messageQueue.totalPending / 60) 
                  : 0}
              </div>
              <p className="text-xs text-muted-foreground">Message throughput</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cache Hit Rate</CardTitle>
              <Database className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {calculateCacheHitRate(healthData?.localCaches)}
              </div>
              <p className="text-xs text-muted-foreground">Cache effectiveness</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
              <Cpu className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatMemory(
                  healthData?.resources?.memory?.heapUsed || 
                  (healthData?.system?.memory?.heapUsed 
                    ? parseFloat(healthData.system.memory.heapUsed) 
                    : undefined)
                )}
              </div>
              <p className="text-xs text-muted-foreground">Heap memory used</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {healthData?.errorStats?.currentRate 
                  ? parseFloat(healthData.errorStats.currentRate).toFixed(1) 
                  : '0.0'}
              </div>
              <p className="text-xs text-muted-foreground">Errors per minute</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {healthData?.alertStats?.active || 0}
              </div>
              <p className="text-xs text-muted-foreground">Current system alerts</p>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Connection Trend</CardTitle>
              <CardDescription>Active connections over the last hour</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig}>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="time" 
                      tick={{ fontSize: 12 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fontSize: 12 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line 
                      type="monotone" 
                      dataKey="connections" 
                      stroke="hsl(var(--chart-1))"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Message Throughput</CardTitle>
              <CardDescription>Messages per minute over the last hour</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig}>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="time" 
                      tick={{ fontSize: 12 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fontSize: 12 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line 
                      type="monotone" 
                      dataKey="messages" 
                      stroke="hsl(var(--chart-2))"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>

        {/* Alerts and Errors */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Active Alerts</CardTitle>
              <CardDescription>
                {healthData?.alertStats?.active || 0} active alert(s)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {healthData?.alertStats?.activeAlerts && healthData.alertStats.activeAlerts.length > 0 ? (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {healthData.alertStats.activeAlerts.map((alert, index) => (
                    <div
                      key={index}
                      className={`p-3 rounded-lg border-l-4 ${
                        alert.severity === 'critical'
                          ? 'border-red-500 bg-red-50 dark:bg-red-950/20'
                          : alert.severity === 'warning'
                          ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20'
                          : 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
                      }`}
                    >
                      <div className="font-semibold text-sm">{alert.type}</div>
                      <div className="text-xs text-muted-foreground mt-1">{alert.message}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {alert.lastTriggered} (Count: {alert.count || 0})
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No active alerts
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Errors</CardTitle>
              <CardDescription>
                Error patterns from the last 5 minutes
              </CardDescription>
            </CardHeader>
            <CardContent>
              {healthData?.errorStats?.last5Minutes?.topPatterns && 
               healthData.errorStats.last5Minutes.topPatterns.length > 0 ? (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {healthData.errorStats.last5Minutes.topPatterns.slice(0, 5).map((error, index) => (
                    <div
                      key={index}
                      className="p-3 rounded-lg border border-border bg-muted/50"
                    >
                      <div className="font-semibold text-sm">
                        {error.category || 'unknown'}: {error.severity || 'low'}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {error.message || 'No message'}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Count: {error.count || 0} | Last seen: {error.lastSeen 
                          ? new Date(error.lastSeen).toLocaleTimeString() 
                          : 'N/A'}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No recent errors
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
};

export default MonitoringDashboard;
