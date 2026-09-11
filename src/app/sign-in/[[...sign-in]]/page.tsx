import { SignIn } from "@clerk/nextjs";
import Image from "next/image";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <Image
        src="/zpc-logo.png"
        alt="Zambezi Portland Cement"
        width={420}
        height={145}
        className="h-14 w-auto"
        priority
      />
      <SignIn />
    </div>
  );
}
