import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { HomeClient } from "@/app/home-client";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <HomeClient />;
}
