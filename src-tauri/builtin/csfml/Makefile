##
## EPITECH PROJECT, {{YEAR}}
## {{PROJECT_NAME}}
## File description:
## Makefile
##

CC		=	epiclang

NAME	=	{{BINARY_NAME}}

SRC		=	src/main.c

OBJ		=	$(SRC:.c=.o)

CFLAGS	+=	-Wall -Wextra

CPPFLAGS	+=	-iquote include

LDLIBS	+=	-lcsfml-graphics -lcsfml-window -lcsfml-system -lcsfml-audio

all:	$(NAME)

$(NAME):	$(OBJ)
	$(CC) -o $(NAME) $(OBJ) $(LDFLAGS) $(LDLIBS)

clean:
	$(RM) $(OBJ)

fclean:	clean
	$(RM) $(NAME)

re:	fclean all

.PHONY:	all clean fclean re
