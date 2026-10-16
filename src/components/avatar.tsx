import { Leaf } from "lucide-react";

// 没有头像时显示昵称首字，没有昵称时显示叶子图标。
export default function Avatar({ src, name, size = 36 }: { src?: string; name?: string | null; size?: number }) {
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
    {src ? <img src={src} alt=""/> : name ? [...name.trim()][0] : <Leaf size={size * 0.45}/>}
  </span>;
}
