import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Copy, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";


interface WhatsAppQRCodeProps {
  agentId: string;
  phoneNumber: string;
}

const WhatsAppQRCode = ({ agentId, phoneNumber }: WhatsAppQRCodeProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { toast } = useToast();
  const [whatsappUrl, setWhatsappUrl] = useState("");

  useEffect(() => {
    generateQRWithLogo();
  }, [agentId, phoneNumber]);

  const generateQRWithLogo = async () => {
    if (!canvasRef.current) return;

    // Format WhatsApp URL: https://wa.me/PHONENUMBER?text=AGENTID
    const formattedPhone = phoneNumber.replace(/[^\d]/g, ""); // Remove non-digits
    const url = `https://wa.me/${formattedPhone}?text=${agentId}`;
    setWhatsappUrl(url);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    canvas.width = 300;
    canvas.height = 300;

    try {
      // Generate QR code on canvas
      await QRCode.toCanvas(canvas, url, {
        width: 300,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
        errorCorrectionLevel: "H", // High error correction for logo overlay
      });

      // Create WhatsApp logo overlay
      const logoSize = 60;
      const bgSize = 80;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // Draw white background for logo
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(
        centerX - bgSize / 2,
        centerY - bgSize / 2,
        bgSize,
        bgSize
      );

      // Draw WhatsApp logo using SVG path
      const logo = new Image();
      logo.onload = () => {
        ctx.drawImage(
          logo,
          centerX - logoSize / 2,
          centerY - logoSize / 2,
          logoSize,
          logoSize
        );
      };
      
      // WhatsApp logo as base64 SVG (official green #25D366)
      logo.src = `data:image/svg+xml;base64,${btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 175.216 175.552">
          <defs>
            <linearGradient id="b" x1="85.915" x2="86.535" y1="32.567" y2="137.092" gradientUnits="userSpaceOnUse">
              <stop offset="0" stop-color="#57d163"/>
              <stop offset="1" stop-color="#23b33a"/>
            </linearGradient>
            <filter id="a" width="1.115" height="1.114" x="-.057" y="-.057" color-interpolation-filters="sRGB">
              <feGaussianBlur stdDeviation="3.531"/>
            </filter>
          </defs>
          <path fill="#b3b3b3" d="m54.532 138.45 2.235 1.324c9.387 5.571 20.15 8.518 31.126 8.523h.023c33.707 0 61.139-27.426 61.153-61.135.006-16.335-6.349-31.696-17.895-43.251A60.75 60.75 0 0 0 87.94 25.983c-33.733 0-61.166 27.423-61.178 61.13a61.05 61.05 0 0 0 8.413 30.814l1.296 2.054-5.486 20.04z" filter="url(#a)"/>
          <path fill="#fff" d="m12.966 161.238 10.439-38.114a73.42 73.42 0 0 1-9.821-36.778c.017-40.556 33.021-73.55 73.578-73.55 19.681.01 38.154 7.669 52.047 21.572s21.537 32.383 21.53 52.037c-.018 40.553-33.027 73.553-73.578 73.553h-.032c-12.313-.005-24.412-3.094-35.159-8.954zm0 0" fill-rule="evenodd"/>
          <path fill="url(#b)" d="m87.184 25.227c-33.733 0-61.166 27.423-61.178 61.13a61.05 61.05 0 0 0 8.413 30.814l1.296 2.054-5.486 20.04 20.574-5.397 1.99 1.174a61.04 61.04 0 0 0 31.089 8.506h.026c33.71 0 61.14-27.426 61.153-61.135a60.75 60.75 0 0 0-17.895-43.251 60.75 60.75 0 0 0-43.233-17.929z"/>
          <path fill="#fff" fill-rule="evenodd" d="M68.772 55.603c-1.378-3.061-2.828-3.123-4.137-3.176l-3.524-.043c-1.226 0-3.218.46-4.902 2.3s-6.435 6.287-6.435 15.332 6.588 17.785 7.506 19.013 12.718 20.381 31.405 27.75c15.529 6.124 18.689 4.906 22.061 4.6s10.877-4.447 12.408-8.74 1.532-7.971 1.073-8.74-1.685-1.226-3.525-2.146-10.877-5.367-12.562-5.981-2.91-.919-4.137.921-4.746 5.979-5.819 7.206-2.144 1.381-3.984.462-7.76-2.861-14.784-9.124c-5.465-4.873-9.154-10.891-10.228-12.73s-.114-2.835.808-3.751c.825-.824 1.838-2.147 2.759-3.22s1.224-1.84 1.836-3.065.307-2.301-.153-3.22-4.032-10.011-5.666-13.647"/>
        </svg>
      `)}`;
    } catch (error) {
      console.error("Error generating QR code:", error);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(whatsappUrl);
    toast({
      title: "Link copied!",
      description: "WhatsApp link copied to clipboard",
    });
  };

  const handleDownloadQR = () => {
    if (!canvasRef.current) return;
    
    const link = document.createElement("a");
    link.download = `whatsapp-agent-${agentId}.png`;
    link.href = canvasRef.current.toDataURL();
    link.click();
    
    toast({
      title: "QR Code downloaded!",
      description: "Saved to your downloads folder",
    });
  };

  return (
    <div className="space-y-4">
      <div className="bg-white p-8 rounded-lg flex items-center justify-center">
        <canvas ref={canvasRef} className="max-w-full h-auto" />
      </div>
      
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground text-center">
          Scan to chat with this agent via WhatsApp
        </p>
        <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
          <code className="text-xs flex-1 truncate">{whatsappUrl}</code>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyLink}>
            <Copy className="mr-2 h-4 w-4" />
            Copy Link
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadQR}>
            <Download className="mr-2 h-4 w-4" />
            Download QR
          </Button>
        </div>
      </div>
    </div>
  );
};

export default WhatsAppQRCode;
