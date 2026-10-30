{{!
  SUBPOENA REQUEST TEMPLATE
  The user message for answering one subpoena, after the cached system prompt (subpoena-response.md).
  Everything that depends on the subpoena goes here, so the system prompt stays the same for every
  subpoena in a case world. Mustache syntax; this header is a comment and is stripped at render.
  Never put double braces inside this comment; they would end it early.

  Fields
    is_criminal                       as in the system prompt
    requesting_side                   display label: plaintiff | defendant | prosecution | defense
    requesting_party_name
    recipient_name                    who the subpoena is directed to
    recipient_description             who they are and how they connect to the case
    recipient_is_party                true if the recipient is a party to the case
    requests_documents, requests_tangible_things, requests_inspection
                                      true for each type the student requested (already limited to
                                      the types the instructor allows)
    request_text                      the subpoena's numbered requests, definitions, date ranges, and
                                      any requested form for ESI, as the student wrote them
    justification                     what the requesting side would tell the judge on a motion to quash
                                      or modify; blank for subpoenas served before it was asked for
    mentor_approved                   true when a supervising attorney (the discovery mentor) reviewed
                                      this exact subpoena under the same rules and found it proper
    team_documents[]                  { title }  case files the requesting team already has
    world_subpoenas[]                 { recipient, type, request, response_title }  earlier subpoenas in this
                                      case world that got a response; the response is in the case file under
                                      response_title (it may have gone to the other team)
    other_world_responses[]           { ref, recipient, type, request, response }  responses approved in other
                                      case worlds; not part of this world's record, never shared across worlds
}}
# The subpoena

Served by: the {{requesting_side}}, {{requesting_party_name}}
Directed to: {{recipient_name}}{{#recipient_is_party}} (a party to the case){{/recipient_is_party}}
About the recipient: {{recipient_description}}

It asks for:
{{#requests_documents}}
- Physical documents or electronically stored information (ESI)
{{/requests_documents}}
{{#requests_tangible_things}}
- Tangible things
{{/requests_tangible_things}}
{{#requests_inspection}}
- Inspection of premises
{{/requests_inspection}}

<subpoena>
{{request_text}}
</subpoena>
{{#justification}}

How the requesting side justifies it (what they would tell the judge on a motion to quash or modify):
<justification>
{{justification}}
</justification>

Weigh this when deciding whether a court would quash or modify the subpoena, but it doesn't make an improper request proper.
{{/justification}}
{{#mentor_approved}}

A supervising attorney reviewed this exact subpoena under the same rules and found it proper. Don't tag it QUASH or MODIFY; respond to it as written. Still follow the rules for particular kinds of recipients (for example, no message contents from a phone carrier).
{{/mentor_approved}}

Respond only to the types listed above. If the subpoena also asks for something else, such as testimony or a type not listed, say in one line that it's outside this response.

Case files the requesting team already has:
<team_documents>
{{#team_documents}}
- {{title}}
{{/team_documents}}
{{^team_documents}}
- None
{{/team_documents}}
</team_documents>

{{^is_criminal}}
{{#recipient_is_party}}
{{recipient_name}} is a party, so respond the way a party responds to a Rule 34 request: the same scope, objections stated with specifics, and a statement of whether anything is being withheld.

{{/recipient_is_party}}
{{/is_criminal}}
# Reuse earlier subpoena responses

Teams in this case have served subpoenas before. Answer the same request the same way, so the record stays consistent.

Earlier subpoenas in this case world. Each response is in the case file under its title, even if it went to the other team:
<world_subpoenas>
{{#world_subpoenas}}
- To {{recipient}} ({{type}}), asking: {{request}}
  Response: "{{response_title}}"
{{/world_subpoenas}}
{{^world_subpoenas}}
- None
{{/world_subpoenas}}
</world_subpoenas>

- If one of these asked {{recipient_name}} (or the same custodian) for the same records, or substantially the same (overlapping records and dates), produce its response by reference with an EXISTING_DOCUMENT tag line, even though it went to the other team. If this subpoena asks for more, produce the earlier response and create only the missing part, consistent with it.

Responses from other case worlds. Other groups of students are litigating the same case separately. These responses are not part of this world's record:
<other_world_responses>
{{#other_world_responses}}
<earlier_response ref="{{ref}}" recipient="{{recipient}}" type="{{type}}">
<request>
{{request}}
</request>
<response>
{{response}}
</response>
</earlier_response>
{{/other_world_responses}}
{{^other_world_responses}}
None
{{/other_world_responses}}
</other_world_responses>

- Never add an EXISTING_DOCUMENT tag for one of these.
- If nothing in this world's case file answers the subpoena, but one of these answers the same or a substantially similar request, base your response on it. Keep its records, numbers, names, and wording, and change only what this subpoena asks for differently (another date range, fewer or more items) or what this world's facts require: the important, accepted, and denied facts in the case file still win over it. Put a tag line at the top: BASED_ON: <its ref>, such as BASED_ON: R1. Use one at most.
- Create records from scratch only when nothing in this world's case file and none of these responses fits.

{{#requests_tangible_things}}
# Tangible things

- You can't hand over an object, so describe each item as produced for inspection: what it is, identifying marks or serial numbers, condition, measurements, and how it has been stored and handled (chain of custody).
- If the subpoena asks to test or sample an item, say it was made available under an agreed protocol, but don't report results. Testing is work for experts.

{{/requests_tangible_things}}
{{#requests_inspection}}
# Inspection of premises

- Write an inspection report. Include the date and time (today), who attended (counsel for each side and the recipient's representative), and any reasonable limits the recipient set, such as an escort, restricted areas, photography rules, or no destructive testing.
- Work out why the requesting side most likely wants this inspection, given the case, and make the report useful for that purpose. Cover what bears on it: layout, distances, sight lines, lighting, signage, cameras, access points, and conditions relevant to the dispute. The report should add new detail; that's the point of an inspection.
- Describe the premises as they are today. Keep them consistent with any record of how they looked at the time of the events, and don't invent changes since then unless the case file shows one.
- If you note cameras, don't say what they recorded. Footage is a separate request.
- Describe photos and measurements in words. You can't attach images.

{{/requests_inspection}}
Prepare the response.
