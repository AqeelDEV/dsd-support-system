import { redirect } from "next/navigation";

/** The workspace opens on the queue; signed-out visitors are sent to sign in from there. */
export default function HomePage() {
  redirect("/queue");
}
