import { Progress } from '@/components/ui/progress';

interface UploadProgressProps {
  fileName: string;
  progress: number;
}

export default function UploadProgress({ fileName, progress }: UploadProgressProps) {
  return (
    <div className="space-y-2 rounded-lg border p-4 bg-muted/40">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium truncate max-w-[70%]" title={fileName}>{fileName}</span>
        <span className="text-muted-foreground">{Math.round(progress)}%</span>
      </div>
      <Progress value={progress} className="h-2" />
    </div>
  );
}

