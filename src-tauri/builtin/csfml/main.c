/*
** EPITECH PROJECT, {{YEAR}}
** {{PROJECT_NAME}}
** File description:
** Entry point
*/

#include <CSFML/Graphics.h>
#include "{{PROJECT_NAME}}.h"

static void handle_events(sfRenderWindow *window)
{
    sfEvent event;

    while (sfRenderWindow_pollEvent(window, &event)) {
        if (event.type == sfEvtClosed)
            sfRenderWindow_close(window);
    }
}

int main(void)
{
    sfVideoMode mode = {{800, 600}, 32};
    sfRenderWindow *window = sfRenderWindow_create(mode, "{{PROJECT_NAME}}",
        sfClose, sfWindowed, NULL);

    if (!window)
        return 84;
    sfRenderWindow_setFramerateLimit(window, 60);
    while (sfRenderWindow_isOpen(window)) {
        handle_events(window);
        sfRenderWindow_clear(window, sfBlack);
        sfRenderWindow_display(window);
    }
    sfRenderWindow_destroy(window);
    return 0;
}
