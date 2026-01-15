import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, Download, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ariaLabels } from '@/lib/accessibility';

interface QRCodeDisplayProps {
  agentName: string;
  qrCode: string;
  onBackToDashboard: () => void;
}

export function QRCodeDisplay({ agentName, qrCode, onBackToDashboard }: QRCodeDisplayProps) {
  const handleDownloadQR = () => {
    const svg = document.getElementById('agent-qr-code');
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${agentName.replace(/\s+/g, '-')}-qr-code.png`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('QR code downloaded');
      });
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Button
        variant="ghost"
        onClick={onBackToDashboard}
        className="mb-6"
        aria-label="Go back to dashboard"
      >
        <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
        Back to Dashboard
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-green-500">
            <CheckCircle className="h-6 w-6" aria-hidden="true" />
            <CardTitle>Agent Created Successfully!</CardTitle>
          </div>
          <CardDescription>
            Scan this QR code with WhatsApp to connect your agent
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col items-center gap-4">
            <div className="bg-white p-8 rounded-lg shadow-lg">
              <QRCodeSVG
                id="agent-qr-code"
                value={qrCode}
                size={256}
                level="H"
                includeMargin
                aria-label={ariaLabels.qrCode.display(agentName)}
              />
            </div>

            <div className="text-center space-y-2">
              <p className="text-lg font-semibold">{agentName}</p>
              <p className="text-sm text-muted-foreground">
                Open WhatsApp → Settings → Linked Devices → Link a Device
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={handleDownloadQR}
              variant="outline"
              className="flex-1"
              aria-label={ariaLabels.qrCode.download}
            >
              <Download className="h-4 w-4 mr-2" aria-hidden="true" />
              Download QR Code
            </Button>
            <Button
              onClick={onBackToDashboard}
              className="flex-1"
            >
              Go to Dashboard
            </Button>
          </div>

          <div className="bg-muted p-4 rounded-lg">
            <h3 className="font-semibold mb-2">Next Steps:</h3>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Open WhatsApp on your phone</li>
              <li>Go to Settings → Linked Devices</li>
              <li>Tap "Link a Device"</li>
              <li>Scan the QR code above</li>
              <li>Your agent will be connected and ready to use!</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
