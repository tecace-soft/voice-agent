
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import type { BusinessProfile } from "@/lib/types";

type Props = {
  profile: BusinessProfile;
  onChange: (profile: BusinessProfile) => void;
};

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="ta-label-1">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="ta-headline-2">{title}</h3>
      {action}
    </div>
  );
}

export function KnowledgeEditor({ profile, onChange }: Props) {
  function patch(partial: Partial<BusinessProfile>) {
    onChange({ ...profile, ...partial });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          id="name"
          label="Business name"
          value={profile.name}
          onChange={(name) => patch({ name })}
        />
        <Field
          id="category"
          label="Category"
          value={profile.category}
          onChange={(category) => patch({ category })}
        />
        <Field
          id="address"
          label="Address"
          value={profile.address}
          onChange={(address) => patch({ address })}
        />
        <Field
          id="phone"
          label="Phone"
          value={profile.phone ?? ""}
          onChange={(phone) => patch({ phone })}
        />
        <Field
          id="website"
          label="Website"
          value={profile.website ?? ""}
          onChange={(website) => patch({ website })}
        />
        <Field
          id="rating"
          label="Rating"
          value={profile.rating ? String(profile.rating) : ""}
          onChange={(value) => patch({ rating: value ? Number(value) : undefined })}
        />
      </div>

      <Separator />

      <div className="space-y-3">
        <SectionHeader
          title="Hours"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patch({
                  hours: [
                    ...profile.hours,
                    {
                      day: DAYS[profile.hours.length % 7]!,
                      open: "09:00",
                      close: "17:00",
                    },
                  ],
                })
              }
            >
              <Plus className="size-4" />
              Add day
            </Button>
          }
        />
        {profile.hours.length === 0 ? (
          <p className="ta-caption-1 text-muted-foreground">No hours recorded.</p>
        ) : null}
        {profile.hours.map((hour, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Input
              className="w-32"
              value={hour.day}
              aria-label="Day"
              onChange={(event) => {
                const hours = [...profile.hours];
                hours[index] = { ...hour, day: event.target.value };
                patch({ hours });
              }}
            />
            <Input
              className="w-28"
              value={hour.open}
              aria-label="Opening time"
              onChange={(event) => {
                const hours = [...profile.hours];
                hours[index] = { ...hour, open: event.target.value };
                patch({ hours });
              }}
            />
            <Input
              className="w-28"
              value={hour.close}
              aria-label="Closing time"
              onChange={(event) => {
                const hours = [...profile.hours];
                hours[index] = { ...hour, close: event.target.value };
                patch({ hours });
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${hour.day}`}
              onClick={() =>
                patch({ hours: profile.hours.filter((_, i) => i !== index) })
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <Separator />

      <div className="space-y-3">
        <SectionHeader
          title="Services"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patch({ services: [...profile.services, { name: "", price: "" }] })
              }
            >
              <Plus className="size-4" />
              Add service
            </Button>
          }
        />
        {profile.services.length === 0 ? (
          <p className="ta-caption-1 text-muted-foreground">No services recorded.</p>
        ) : null}
        {profile.services.map((service, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Input
              className="min-w-48 flex-1"
              value={service.name}
              placeholder="Name"
              aria-label="Service name"
              onChange={(event) => {
                const services = [...profile.services];
                services[index] = { ...service, name: event.target.value };
                patch({ services });
              }}
            />
            <Input
              className="w-32"
              value={service.price ?? ""}
              placeholder="Price"
              aria-label="Service price"
              onChange={(event) => {
                const services = [...profile.services];
                services[index] = { ...service, price: event.target.value };
                patch({ services });
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove service"
              onClick={() =>
                patch({ services: profile.services.filter((_, i) => i !== index) })
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <Separator />

      <div className="space-y-4">
        <SectionHeader title="Policies" />
        <div className="grid gap-4 md:grid-cols-2">
          {(
            [
              ["reservations", "Reservations"],
              ["walkIns", "Walk-ins"],
              ["parking", "Parking"],
              ["payment", "Payment"],
              ["cancellation", "Cancellation"],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              id={`policy-${key}`}
              label={label}
              value={profile.policies?.[key] ?? ""}
              onChange={(value) =>
                patch({ policies: { ...profile.policies, [key]: value } })
              }
            />
          ))}
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <SectionHeader title="Highlights" />
        <Textarea
          className="min-h-24"
          aria-label="Highlights, one per line"
          value={profile.highlights.join("\n")}
          placeholder="One highlight per line"
          onChange={(event) =>
            patch({
              highlights: event.target.value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
            })
          }
        />
      </div>

      <Separator />

      <div className="space-y-3">
        <SectionHeader
          title="Caller questions"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => patch({ faqs: [...profile.faqs, { q: "", a: "" }] })}
            >
              <Plus className="size-4" />
              Add question
            </Button>
          }
        />
        {profile.faqs.length === 0 ? (
          <p className="ta-caption-1 text-muted-foreground">No questions recorded.</p>
        ) : null}
        {profile.faqs.map((faq, index) => (
          <div key={index} className="flex flex-wrap items-start gap-2">
            <Input
              className="min-w-48 flex-1"
              value={faq.q}
              placeholder="Question"
              aria-label="Question"
              onChange={(event) => {
                const faqs = [...profile.faqs];
                faqs[index] = { ...faq, q: event.target.value };
                patch({ faqs });
              }}
            />
            <Input
              className="min-w-48 flex-1"
              value={faq.a}
              placeholder="Answer"
              aria-label="Answer"
              onChange={(event) => {
                const faqs = [...profile.faqs];
                faqs[index] = { ...faq, a: event.target.value };
                patch({ faqs });
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove question"
              onClick={() => patch({ faqs: profile.faqs.filter((_, i) => i !== index) })}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
