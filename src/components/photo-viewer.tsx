"use client";

import { X } from "lucide-react";

export default function PhotoViewer({ src, onClose }: { src: string; onClose: () => void }) {
  return <div className="photo-viewer" role="dialog" aria-modal="true" onClick={onClose}>
    <button className="photo-viewer-close" aria-label="关闭" onClick={onClose}><X size={22}/></button>
    <img src={src} alt="饮食照片"/>
  </div>;
}
