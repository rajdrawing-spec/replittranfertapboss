import * as React from "react";

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Optional content shown while the image loads. */
  fallback?: React.ReactNode;
}

/**
 * Lazy-loading image wrapper with a skeleton/fallback state and fade-in.
 * Prefer this over a raw `<img>` for any image that is below the fold or
 * rendered in a list (logos, thumbnails, etc.) to reduce LCP/INP work.
 */
export function LazyImage({ fallback, ...props }: LazyImageProps) {
  const [loaded, setLoaded] = React.useState(false);

  return (
    <div className="relative w-full h-full">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 animate-pulse rounded-[inherit]">
          {fallback ?? <span className="sr-only">Loading image</span>}
        </div>
      )}
      <img
        {...props}
        loading={props.loading ?? "lazy"}
        decoding={props.decoding ?? "async"}
        onLoad={(e) => {
          setLoaded(true);
          props.onLoad?.(e);
        }}
        className={`${props.className || ""} ${loaded ? "opacity-100" : "opacity-0"} transition-opacity duration-300`}
      />
    </div>
  );
}
