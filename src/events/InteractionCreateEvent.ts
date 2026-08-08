import type { ClientEvents, Interaction } from 'discord.js';
import { EventHandler } from '../core/EventRegistry.js';
import type { CommandRegistry } from '../core/CommandRegistry.js';

/** Routes chat-input interactions to the command registry. */
export class InteractionCreateEvent extends EventHandler<'interactionCreate'> {
  public readonly event = 'interactionCreate' as const;

  constructor(private readonly commands: CommandRegistry) {
    super();
  }

  public async handle(...args: ClientEvents['interactionCreate']): Promise<void> {
    const [interaction] = args as [Interaction];
    if (!interaction.isChatInputCommand()) return;
    await this.commands.dispatch(interaction);
  }
}
