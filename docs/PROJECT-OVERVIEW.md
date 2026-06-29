# Halevora Tasks: Project Overview

*A plain-language summary for the team. No coding knowledge needed.*

---

## What we're building, in one line

Halevora Tasks is our own private version of ClickUp's task board. We build it, we host it, and we shape it around how the Halevora team actually works.

## Why build our own instead of paying for ClickUp

Three reasons:

- **It's ours.** Our data lives on our database, under our control. Nobody can change the price, the rules, or the features out from under us.
- **No per-person fees.** ClickUp charges for every seat. Ours runs on free service tiers to start, so adding team members costs nothing.
- **It fits us exactly.** We copy the parts of ClickUp we like and change the two things we need to work differently (explained below).

We're not reinventing the wheel. The board will look and feel like ClickUp's, because that layout already works. We're rebuilding it so we own it.

## What it looks like

Picture ClickUp's Board view. The look mirrors ClickUp's familiar dark board, so anyone who has used ClickUp will feel at home from the first click.

Columns run across the screen. Each column is a **Board**: one workstream, like Innovations, Client Success, Lucky Phone Farm, or Meta Ads. Inside each column sit **task cards**. You drag a card from one column to another to move the work along. Click any card to open a detail panel with everything about that task.

> **A quick note on words.** We call a column a "Board." (ClickUp calls it a "List.") Each Board has its own chat. A "Task" is a single card that lives on one Board.

## What you'll be able to do

This is the first full version. Everything here is planned and agreed.

**The basics**
- Group work into Boards (columns), one per workstream, each with its own chat.
- Create tasks as cards.
- Move a task through its stages: To Do, then In Progress, then Done, then Reviewed.
- Add many tasks fast with a quick-entry view, without opening each one.
- See what's late. Overdue tasks flag themselves automatically once the due date passes.
- Once a task is Reviewed, it leaves the board and moves into a separate Reviewed list, so the board stays clean.

**On each task**
- Assign it to one person or several.
- Set a start date and a due date with a calendar picker.
- Write a full description with formatting, like a mini document, with optional AI help to draft it.
- Break it into subtasks, or add a quick checklist of small to-dos.
- Add a time estimate, tags, a star rating, and a progress slider.
- Leave comments and read the full history of who changed what and when.
- Attach files.
- Set a priority: Urgent, High, Normal, or Low.

**Repeating work**
- Set a task to repeat daily, weekly, monthly, yearly, or on a custom schedule.
- When it repeats, a fresh copy appears and the old one moves off the board.

**Finding and following work**
- Switch views: the full Board, My Tasks, Today, the Calendar, or the Reviewed list.
- Sort and filter to focus on what matters right now.
- Get notified when something needs you, and tag a teammate with @ to pull them in.
- Search across everything in one place.

**Power features**
- Link tasks so one waits on another, and see at a glance what is blocked.
- Save any task as a reusable template, then create new tasks from it in seconds.
- Select many tasks and update them all at once.
- Build your own automation rules, like "when a task is marked Done, notify the person who created it."

**Built-in safety**
- Nothing is ever deleted for good. You archive things, and you can restore them later.
- The app handles time zones, so dates read correctly wherever a team member sits.

## Two decisions worth understanding

These are the two places where we deliberately work differently from standard ClickUp.

**1. People see only their own tasks.**
You, as CEO, see every task across every board. A team member sees only the tasks assigned to them. This keeps each person's view focused and keeps work private by default. Anyone can still hand a task to anyone else. (Standard ClickUp shows everyone almost everything, which we don't want.)

**2. Repeating tasks start fresh as "To Do."**
When a recurring task comes around again, the new copy starts at To Do, ready to be picked up. This matches how the team thinks about recurring work. (Modern ClickUp forces a special "New" status here, which felt wrong for us.)

## What we're leaving for later, on purpose

To ship sooner, the first version skips two things. We can add them once the core is proven:

- A built-in stopwatch for tracking time spent on a task.
- A dedicated phone app that works offline.

One clarification on the second point: the app still works on your phone through a web browser, and the final stage tunes the layout for small screens. What we skip for now is a separate installable app that keeps working with no internet.

## How we build it

We build in numbered sections, one focused chunk at a time. After each chunk we test it and write a short handoff note. That way progress is always traceable, and we never stack new work on a shaky foundation.

Here's the full plan:

| Section | What it delivers |
|--------|------------------|
| 0 | **Foundation**: the empty app skeleton and the visual design system (colors, spacing, fonts). *We start here.* |
| 1 | **The data**: how boards, tasks, dependencies, checklists, templates, and automation rules get stored. |
| 2 | **Logins and permissions**: signing in, and the rule that members see only their own tasks. |
| 3 | **The board**: columns, cards, status labels, the late-task flag, and drag-to-move. |
| 4 | **Task details, part 1**: assignees, dates, priority, tags, description, subtasks, and checklists. |
| 5 | **Task details, part 2**: ratings and sliders, file attachments, comments, and history. |
| 6 | **Task dependencies**: linking tasks, showing what is blocked, and stopping a task from closing while it waits on another. |
| 7 | **Repeating tasks**: the setup and the engine that creates the next copy. |
| 8 | **Automation**: the build-your-own rules engine and its editor. This is the biggest piece and may run across two chats. |
| 9 | **Views, sorting, filtering**: My Tasks, Today, Calendar, Reviewed, and saved filters. |
| 10 | **Templates and bulk edit**: reuse a task as a template, and change many tasks at once. |
| 11 | **Live updates and chat**: the board updates as others work, plus per-board chat. |
| 12 | **Notifications, mentions, search**: staying on top of what needs you. |
| 13 | **Polish**: final look, accessibility, phone layout, and the rough edges. |

## Where we are right now

Section 0 is starting: the foundation. This builds the empty, well-organized app and locks in the visual design system. There's nothing to click yet. It's the skeleton everything else hangs on, like pouring the slab before framing a house.

## The tech, in one breath (skip if you like)

Built with mainstream, well-supported web tools (Next.js and TypeScript). Data lives in a managed database called Supabase, on its free tier to start. We host it ourselves, so there's no ClickUp subscription.

## What it costs

To start: nothing beyond the time to build it. The database and hosting run on free tiers. There are no per-person license fees, which is the part that grows with every ClickUp seat.

---

*Questions about anything here? Ask, and we'll translate.*
