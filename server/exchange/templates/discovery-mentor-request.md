{{!
  DISCOVERY MENTOR REQUEST TEMPLATE
  The user message for one feedback pass, after the cached system prompt (discovery-mentor.md): what
  the team is working on and its draft. Fields are the same as the system prompt's. Mustache syntax;
  this header is a comment and is stripped at render. Never put double braces inside this comment.
}}
# What the team is working on

{{#is_drafting}}
{{#is_subpoena}}
The team is drafting a subpoena to {{subpoena_recipient}}, asking for: {{subpoena_types}}.
{{/is_subpoena}}
{{#is_interrogatories}}
The team is drafting interrogatories to serve on {{opposing_party_name}}. It has already served {{interrogatories_already_served}} interrogatories on this party, and the limit is {{interrogatory_limit}}, including discrete subparts.
{{/is_interrogatories}}
{{#is_rfas}}
The team is drafting requests for admission to serve on {{opposing_party_name}}.
{{/is_rfas}}
{{/is_drafting}}
{{#is_answering}}
{{#is_interrogatories}}
The team is drafting its answers and objections to interrogatories served by {{opposing_party_name}}.
{{/is_interrogatories}}
{{#is_rfas}}
The team is drafting its responses to requests for admission served by {{opposing_party_name}}.
{{/is_rfas}}

The requests being answered:
<served_requests>
{{served_requests}}
</served_requests>
{{/is_answering}}

The team's draft:
<student_draft>
{{student_draft}}
</student_draft>
{{#student_goal}}

What the team says it's trying to accomplish:
<student_goal>
{{student_goal}}
</student_goal>
{{/student_goal}}

Review this draft.
