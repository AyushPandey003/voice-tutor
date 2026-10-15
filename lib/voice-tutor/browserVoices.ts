// Web Speech doesn't expose gender. Label only familiar named voices; never
// pretend every browser/OS provides a particular male/female voice.
export function voiceGroup(name: string): "Male" | "Female" | "Other / unspecified" {
  if (/\b(david|mark|guy|ryan|george|james|daniel|ravi|prabhat|brian|andrew|christopher|eric|roger|thomas|paul)\b/i.test(name)) return "Male";
  if (/\b(zira|jenny|aria|sonia|susan|hazel|samantha|victoria|karen|moira|tessa|heera|swara|natasha|sara|emma|ava|michelle|jane|linda|catherine)\b/i.test(name)) return "Female";
  return "Other / unspecified";
}
