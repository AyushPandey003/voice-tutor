import TutorPage from "./TutorPage";

// Read deployment configuration at request time (also works with Docker env_file).
export const dynamic = "force-dynamic";

export default function Page() {
  return <TutorPage byokRequired={process.env.BYOK_ENABLED === "true"} />;
}
