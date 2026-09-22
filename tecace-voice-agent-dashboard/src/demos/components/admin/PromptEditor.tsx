
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LIVE_VOICE_OPTIONS, type CallSound, type CustomerPrompts } from "@/lib/types";
import { LANGUAGES, languageOf } from "@/lib/languages";
import { Switch } from "@/components/ui/switch";
import { resolveCallSound } from "@/lib/call-audio";
import { AMBIENCE_LEVELS, type AmbienceLevel } from "@/lib/ambience";

const AMBIENCE_LABEL: Record<AmbienceLevel, string> = {
  off: "Silent — nothing behind the voice",
  quiet: "Quiet office — someone talking in the next room",
  busy: "Busy front desk — voices, typing, a phone going",
};

type Props = {
  agentName: string;
  voice: string;
  language?: string;
  callSound?: Partial<CallSound> | null;
  onCallSoundChange: (sound: CallSound) => void;
  prompts: CustomerPrompts;
  onAgentNameChange: (value: string) => void;
  onVoiceChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onPromptsChange: (prompts: CustomerPrompts) => void;
  onRegenerate: () => void;
  regenerating: boolean;
};

function PromptField({
  id,
  label,
  description,
  value,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="ta-label-1">
        {label}
      </Label>
      <p className="ta-caption-1 text-muted-foreground">{description}</p>
      <Textarea
        id={id}
        className="min-h-48 font-mono text-[13px] leading-5"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="ta-caption-1 text-muted-foreground">
        {value.length} characters
      </p>
    </div>
  );
}

export function PromptEditor({
  agentName,
  voice,
  language,
  callSound,
  onCallSoundChange,
  prompts,
  onAgentNameChange,
  onVoiceChange,
  onLanguageChange,
  onPromptsChange,
  onRegenerate,
  regenerating,
}: Props) {
  const sound = resolveCallSound(callSound);
  const selected = LIVE_VOICE_OPTIONS.find((option) => option.id === voice);
  const opensIn = languageOf(language);

  return (
    <div className="space-y-6">
      {/*
        Two columns, not four. The detail page gives this panel two thirds of
        the width, and four columns put "Gleam · North American" and
        "Korean · 한국어" into each other.
      */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="agentName" className="ta-label-1">
            Receptionist name
          </Label>
          <Input
            id="agentName"
            value={agentName}
            onChange={(event) => onAgentNameChange(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="voice" className="ta-label-1">
            Voice
          </Label>
          <Select value={voice} onValueChange={(value) => onVoiceChange(value ?? voice)}>
            <SelectTrigger id="voice">
              <SelectValue>
                {selected ? `${selected.label} · ${selected.accent}` : voice}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {LIVE_VOICE_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label} · {option.accent} · {option.presentation}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="ta-caption-1 text-muted-foreground">
            Pick a North American voice for a US business. The accent comes from the
            voice, not the prompt.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="language" className="ta-label-1">
            Opens in
          </Label>
          <Select
            value={opensIn.code}
            onValueChange={(value) => onLanguageChange(value ?? opensIn.code)}
          >
            <SelectTrigger id="language">
              <SelectValue>
                {opensIn.label === opensIn.native
                  ? opensIn.label
                  : `${opensIn.label} · ${opensIn.native}`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((option) => (
                <SelectItem key={option.code} value={option.code}>
                  {option.label === option.native
                    ? option.label
                    : `${option.label} · ${option.native}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="ta-caption-1 text-muted-foreground">
            Only where the call starts. It still follows a caller into any language.
            The accent stays the voice&rsquo;s, whatever language it speaks.
          </p>
        </div>
        <div className="flex items-end">
          <Button variant="outline" onClick={onRegenerate} disabled={regenerating}>
            <RefreshCw className="size-4" />
            {regenerating ? "Rebuilding" : "Rebuild from data"}
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div>
          <h3 className="ta-headline-2">Call sound</h3>
          <p className="ta-caption-1 text-muted-foreground">
            Applied in the browser during playback, so the call sounds like a phone
            call instead of a studio recording.
          </p>
        </div>
        <label className="ta-label-1 flex items-center justify-between gap-4">
          <span>
            Phone line
            <span className="ta-caption-1 text-muted-foreground block">
              Narrows the voice to the telephone band.
            </span>
          </span>
          <Switch
            checked={sound.phoneLine}
            onCheckedChange={(checked) =>
              onCallSoundChange({ ...sound, phoneLine: checked })
            }
            aria-label="Apply the phone line filter"
          />
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="ambience" className="ta-label-1">
            Behind the receptionist
            <span className="ta-caption-1 text-muted-foreground block font-normal">
              A room with people working in it. Pick one on a real call — it is
              built to sit under the voice, so it is meant to be noticed rather
              than listened to.
            </span>
          </Label>
          <Select
            value={sound.ambience}
            onValueChange={(value) =>
              onCallSoundChange({
                ...sound,
                ambience: (value as AmbienceLevel) ?? sound.ambience,
              })
            }
          >
            <SelectTrigger id="ambience" aria-label="Background ambience">
              <SelectValue>{AMBIENCE_LABEL[sound.ambience]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {AMBIENCE_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {AMBIENCE_LABEL[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {prompts.edited ? (
        <div className="bg-primary/10 ta-caption-1 text-primary rounded-lg p-3">
          These prompts were edited by hand. Re-research keeps them unless you rebuild.
        </div>
      ) : null}

      <PromptField
        id="prompt-live"
        label="Voice prompt"
        description="Runs on GPT-Live. Keep it about manner, pace, and the facts worth answering instantly."
        value={prompts.live}
        onChange={(live) => onPromptsChange({ ...prompts, live, edited: true })}
      />
      <PromptField
        id="prompt-backend"
        label="Backend prompt"
        description="Runs on the delegated model. Holds the full profile and the rules for looking things up."
        value={prompts.backend}
        onChange={(backend) => onPromptsChange({ ...prompts, backend, edited: true })}
      />
      <PromptField
        id="prompt-greeting"
        label="Greeting"
        description="Sent once the session starts, so the receptionist speaks first."
        value={prompts.greeting}
        onChange={(greeting) => onPromptsChange({ ...prompts, greeting, edited: true })}
      />
    </div>
  );
}
