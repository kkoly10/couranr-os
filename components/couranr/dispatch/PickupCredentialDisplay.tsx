"use client";

import * as React from "react";
import qrcode from "qrcode-generator";
import { formatPickupCredentialPayload } from "@/lib/couranr/driver/pickupCredential";

function qrPath(value:string):{path:string;count:number} {
  const qr=qrcode(0,"M");
  qr.addData(value);
  qr.make();
  const count=qr.getModuleCount();
  let path="";
  for(let row=0;row<count;row+=1) {
    for(let col=0;col<count;col+=1) {
      if(qr.isDark(row,col)) path+=`M${col},${row}h1v1h-1z`;
    }
  }
  return {path,count};
}

export function PickupCredentialDisplay({
  deliveryId,
  code,
  warning,
}:{
  deliveryId:string;
  code:string;
  warning?:string;
}) {
  const payload=React.useMemo(
    ()=>formatPickupCredentialPayload(deliveryId,code),
    [deliveryId,code],
  );
  const qr=React.useMemo(()=>qrPath(payload),[payload]);

  return (
    <div data-couranr-pickup-credential="true">
      <div
        style={{
          display:"grid",
          placeItems:"center",
          padding:"var(--couranr-space-4)",
          background:"#fff",
          borderRadius:"var(--couranr-radius-md)",
          maxWidth:280,
        }}
      >
        <svg
          role="img"
          aria-label="Pickup QR code"
          viewBox={`0 0 ${qr.count} ${qr.count}`}
          width="240"
          height="240"
          shapeRendering="crispEdges"
        >
          <rect width={qr.count} height={qr.count} fill="#fff" />
          <path d={qr.path} fill="#000" />
        </svg>
      </div>
      <div
        aria-label={`Pickup code ${code.split("").join(" ")}`}
        style={{
          fontFamily:"var(--couranr-font-mono)",
          fontSize:"var(--couranr-text-3xl)",
          fontWeight:700,
          letterSpacing:"0.22em",
          marginTop:"var(--couranr-space-3)",
        }}
      >
        {code.slice(0,3)} {code.slice(3)}
      </div>
      {warning ? (
        <p style={{marginTop:"var(--couranr-space-2)"}}>
          {warning}
        </p>
      ) : null}
    </div>
  );
}
