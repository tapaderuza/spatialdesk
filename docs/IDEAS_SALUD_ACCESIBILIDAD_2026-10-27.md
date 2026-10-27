# SpatialDesk: 72 ideas de salud, discapacidad y autonomía

Fecha: 27 de octubre de 2026. Lluvia de ideas y priorización con ECC Product Lens.

La propuesta central es que una persona pueda adaptar el espacio a sus capacidades de hoy, realizar una tarea cotidiana, parar y volver sin perder el hilo. Las ideas son hipótesis de producto; no son beneficios clínicos demostrados ni una promesa de premio.

## Cómo leer el catálogo

- **Ampliar**: aprovecha una función que ya existe en el prototipo local. No significa que la ampliación esté implementada.
- **Nueva**: función propuesta, pendiente de desarrollar y probar con usuarios.
- **Clínica**: línea futura que requiere profesionales, validación específica y estudiar su encaje regulatorio según el uso previsto.

La base actual incluye adaptación de distancia, tamaño, lado, giro y altura; voz; selección sin manos; propuestas revisables y Deshacer; sesiones según tiempo y energía declarada; un punto de retorno; ajustes guardados voluntariamente; y colocación en superficies de una habitación simulada. Las pruebas en el emulador no acreditan comodidad, rendimiento ni precisión en unas Quest físicas.

## Qué puede convencer al jurado

Los criterios ponderan por igual innovación, experiencia, ejecución técnica y presentación. Destacan uso repetido, adecuación al público, uso significativo de capacidades del dispositivo y rendimiento en hardware Quest. Mi recomendación es demostrar un recorrido completo con una persona concreta, apoyado por pruebas reales, y presentar el catálogo amplio como evolución futura. [Criterios oficiales](https://start-developer-competition-26.devpost.com/details/judging).

## A. Movilidad, alcance y precisión

1. **Calibración guiada de comodidad — Ampliar.** Preguntas breves y ejemplos de lectura y selección para elegir distancia, tamaño, lado y giro. La persona decide qué ajuste le resulta cómodo; la aplicación no mide dolor ni determina límites médicos.
2. **Zona de interacción elegida por la persona — Ampliar.** Concentrar los controles en el sector que pueda utilizar hoy, sin exigir buscar elementos girando todo el cuello.
3. **Selección configurable para temblor — Nueva.** Estabilización de la puntería, margen de tolerancia y tiempo de confirmación ajustables; comparar errores y esfuerzo con personas que necesiten ese modo.
4. **Navegación con un único pulsador — Nueva.** Recorrer opciones mediante barrido y seleccionar con una sola entrada, con velocidad regulable. Depende de integrar y probar un dispositivo de entrada compatible.
5. **Recorrido completo por voz con alternativas — Ampliar.** Ampliar órdenes, correcciones y confirmaciones para completar tareas sin gestos precisos; ofrecer siempre otra entrada si la voz falla.
6. **Cambiar de mano o de método en cualquier momento — Ampliar.** Pasar de mano derecha a izquierda, voz o selección sin manos sin rehacer el espacio ni perder trabajo.

Son propuestas alineadas con necesidades de personalización, distintas entradas y ajuste de interacción descritas por W3C; esto no constituye una certificación de accesibilidad. [Requisitos de usuarios de entornos inmersivos, W3C](https://www.w3.org/TR/xaur/).

## B. Visión y lectura

7. **Lectura adaptable y fuentes completas — Ampliar.** Tipografía, tamaño, separación y anchura de línea configurables, con acentos y caracteres de los idiomas admitidos.
8. **Lupa de lectura estable — Nueva.** Ampliar una tarjeta o documento en un panel fijo sin tener que acercar físicamente la cabeza.
9. **Paletas elegibles y estados que no dependan del color — Ampliar.** Combinar texto, forma y contraste para que un cambio no se comunique únicamente con rojo o verde.
10. **Lectura en voz alta de toda la interfaz — Ampliar.** Extender la lectura de planes a tareas, botones, pistas y errores; permitir repetir y regular la velocidad.
11. **Vista 2D semántica para lectores de pantalla — Nueva.** Una alternativa con estructura y controles accesibles en navegador, probada con lectores reales; no basta con que el texto se dibuje en el panel 3D.
12. **Distribución en la zona visible elegida — Nueva.** Permitir que la persona coloque el contenido en el área que prefiera ver, sin atribuir ni diagnosticar una alteración visual.

## C. Audición y alternativas al sonido

13. **Subtítulos personalizables del diálogo — Nueva.** Texto visible del intercambio con el acompañante, con opciones de tamaño y permanencia.
14. **Avisos visuales y hápticos alternativos — Nueva.** Ofrecer señales comprensibles para fin de bloque y errores; la vibración dependerá del controlador o dispositivo disponible.
15. **Volúmenes separados — Nueva.** Ajustar voz, ambiente y avisos de forma independiente.
16. **Opción de audio mono — Nueva.** No exigir distinguir izquierda y derecha por el sonido para entender la aplicación.
17. **Posición de subtítulos elegible — Nueva.** Evitar que tapen la tarea o los controles, con una posición estable acordada con el usuario.
18. **Conversación escrita con el agente — Nueva.** Poder pedir ayuda y corregir propuestas escribiendo, sin necesitar hablar ni oír.

## D. Habla y comunicación

19. **Tablero de comunicación aumentativa y alternativa — Nueva.** Frases elegidas por la persona, como «necesito una pausa» o «quiero ayuda», que pueda seleccionar y reproducir con voz.
20. **Respuestas mediante sí, no y opciones claras — Ampliar.** Permitir expresar elecciones sin una frase larga; distinguir responder a una pregunta de autorizar un cambio.
21. **Compositor de mensajes con voz — Nueva.** Escribir o seleccionar palabras y reproducir el mensaje, con edición y confirmación del contenido.
22. **Dictado al ritmo de la persona — Ampliar.** Ajustar tolerancia a pausas y duración de escucha, con un control claro para terminar manualmente.
23. **Diccionario personal de órdenes — Nueva.** Alias y correcciones escogidos por el usuario para sus expresiones habituales, sin inferir lo que pretendía decir.
24. **Idiomas y traducción con original visible — Ampliar.** Facilitar comunicación entre usuario y acompañante conservando el texto original y señalando incertidumbre de la traducción.

Un tablero genérico sería un prototipo de comunicación, no una solución adecuada para todas las personas. La selección de vocabulario y acceso necesita participación de sus usuarios; una intervención individual puede requerir logopedia. [Referencia profesional de ASHA sobre comunicación aumentativa y alternativa](https://www.asha.org/practice-portal/professional-issues/augmentative-and-alternative-communication/).

## E. Memoria, comprensión y atención

25. **Una tarea convertida en pasos verificables — Ampliar.** Extender Start small a una lista breve; la persona confirma cada paso y puede corregirlo, saltarlo o deshacerlo.
26. **Una sola acción principal en pantalla — Nueva.** Mostrar el paso actual y guardar el resto del contenido detrás de una opción predecible.
27. **Rutinas con imágenes y texto — Nueva.** Secuencias elegidas por la persona para gestiones diarias, manteniendo un lenguaje adulto.
28. **Varios puntos de retorno — Ampliar.** Extender el marcador actual a distintos contextos, por ejemplo trabajo, estudio y gestiones, siempre con guardado explícito.
29. **Explicaciones en lectura fácil — Nueva.** Botones como «explícamelo más sencillo» o «dime solo el siguiente paso», preservando los datos importantes.
30. **Ayuda «me he perdido» — Nueva.** Ofrecer tres salidas claras: recordar la tarea actual, repetir el paso o volver al inicio.

Estas ideas se apoyan en patrones de claridad, recuperación de errores y menor dependencia de la memoria; no implican tratar TDAH, demencia u otras condiciones. [Guía cognitiva de W3C](https://www.w3.org/TR/coga-usable/).

## F. Fatiga, dolor y capacidades variables

31. **Tiempo y esfuerzo disponibles decididos por la persona — Ampliar.** Afinar las sesiones actuales para que el usuario pueda escoger una participación breve y detenerla en cualquier momento, sin progresión automática.
32. **Pausa tranquila en una acción — Ampliar.** Unir pausa del reloj, reducción voluntaria de avisos y conservación del siguiente paso, con una salida fácil.
33. **Registro subjetivo y opcional de energía — Nueva.** Anotar cómo se siente la persona si lo desea, sin deducir enfermedad, emoción o capacidad a partir de sus movimientos.
34. **Replanificar un día difícil — Ampliar.** Posponer lo que el usuario elija sin penalizar descansos ni modificar citas por su cuenta.
35. **Alternar visor y pantalla convencional — Nueva.** Continuar la tarea desde otro formato cuando la persona prefiera dejar de usar el visor.
36. **Configuraciones por contexto — Ampliar.** Guardar ajustes para una silla, una postura reclinada o distintos espacios; evitar etiquetas diagnósticas automáticas.

## G. Salud cotidiana y preparación de consultas

37. **Preparador de consultas — Nueva.** Ayudar a organizar preguntas, observaciones propias y documentos que la persona quiere llevar; revisar el resultado antes de exportarlo.
38. **Cronología personal de observaciones — Nueva.** Registrar lo que el usuario comunica y cuándo, sin convertirlo en un diagnóstico ni un nivel de urgencia automático.
39. **Agenda de citas y trámites accesible — Nueva.** Recordar fecha, lugar, documentación y preguntas pendientes, con los mismos métodos de acceso que el espacio de trabajo.
40. **Lectura fácil de instrucciones administrativas — Nueva.** Explicar trámites, cartas de citas y formularios manteniendo el original y permitiendo comprobar cada dato.
41. **Recordatorios de un plan indicado por profesionales — Nueva.** Reproducir un plan revisado, sin inventar pautas, cambiar dosis ni recomendar compensaciones de una toma olvidada.
42. **Resumen para llevar a un profesional — Nueva.** Documento breve que el usuario puede editar y aprobar; compartirlo sería una acción separada y explícita.

Guardar síntomas, medicación o informes requeriría diseñar un módulo de datos de salud con protección y permisos específicos. El guardado de ajustes o de tareas actual no debe presentarse como una historia clínica segura.

## H. Familia, cuidadores y apoyo elegido

43. **Ayuda de configuración desde un móvil — Nueva.** Una persona autorizada propone ajustes y el usuario conserva la aprobación final.
44. **Compañía humana voluntaria — Nueva.** Presencia compartida para trabajar o hacer una gestión, con controles de entrada, salida y privacidad.
45. **Compartir solamente tareas escogidas — Nueva.** Acceso limitado a lo autorizado, sin entregar todo el espacio ni las notas personales.
46. **Pedir ayuda cotidiana con un mensaje preparado — Nueva.** Elegir contacto y revisar el mensaje antes de enviarlo; no se presentaría como servicio de emergencias.
47. **Tarjeta de preferencias de acceso — Nueva.** Compartir voluntariamente cómo prefiere interactuar la persona, sin exigir revelar su diagnóstico.
48. **Guía de apoyo personalizada — Nueva.** Instrucciones que el usuario decide mostrar a quien le ayude: qué puede configurar y qué prefiere controlar por sí mismo.

## I. Habitación y dispositivos

49. **Puesto adaptado sobre una superficie elegida — Ampliar.** Extender Fit room con ajuste manual y confirmación de la colocación; no confundir reconocer un plano con garantizar seguridad física.
50. **Acercar una tarea concreta — Ampliar.** Traer el panel necesario a una zona de uso elegida, conservando el resto del espacio cuando sea posible.
51. **Recuperación clara de la interfaz — Nueva.** Un acceso consistente para recuperar menús si se pierde la referencia, sin pedir a la persona que se levante o busque girándose.
52. **Control ocular en dispositivos compatibles — Ampliar.** Probar seguimiento de ojos cuando el visor y la aplicación lo permitan, con alternativa por otro método de entrada.
53. **Interfaz complementaria 2D — Nueva.** Versión accesible en móvil u ordenador para quien no pueda o no quiera usar un visor, con transferencia de tarea controlada.
54. **Integración de entradas alternativas — Nueva.** Evaluar pulsador, teclado, pedal u otros mandos compatibles, con funciones asignables y pruebas en cada combinación de hardware.

Quest 3 y Quest 3S no incorporan hardware de seguimiento ocular; Meta identifica Quest Pro y Meta VR Glasses como compatibles. La documentación consultada es de Unity: la disponibilidad en nuestro navegador y SDK se debe comprobar por separado. [Documentación de Meta](https://developers.meta.com/vr/documentation/unity/move-eye-tracking/).

## J. Conocimiento y comportamiento del agente

55. **Guía experta del uso de SpatialDesk — Ampliar.** Responder con instrucciones comprobadas de la aplicación y reconocer funciones que no están disponibles.
56. **Información general de salud con fuentes revisadas — Nueva.** Contenido acotado, procedencia y fecha visibles, con mecanismos para decir «no lo sé» y sin diagnosticar a la persona.
57. **Aclarar antes de adaptar — Ampliar.** Preguntas breves que distingan dificultades de lectura, alcance o comprensión y propongan un solo cambio comprobable.
58. **Explicar la consecuencia antes de aplicar — Ampliar.** Mostrar qué cambiará y permitir comparar, aceptar o deshacer, evitando afirmar alivio de síntomas.
59. **Historial comprensible de decisiones — Ampliar.** Distinguir lo propuesto, descartado, aplicado y deshecho; cualquier persistencia adicional requeriría elección explícita.
60. **Ayuda local cuando no hay conexión — Ampliar.** Instrucciones y operaciones básicas verificadas, identificadas como locales y sin simular una respuesta de Nova.

La OMS advierte de respuestas sanitarias generativas falsas o incompletas y de confiar demasiado en ellas. Por eso el agente de apoyo cotidiano y los futuros usos clínicos deben tener alcances diferentes y validación correspondiente. [Guía y recomendaciones de la OMS](https://www.who.int/news/item/18-01-2024-who-releases-ai-ethics-and-governance-guidance-for-large-multi-modal-models).

## K. Control, privacidad y evidencia de utilidad

61. **Centro de memoria controlado por el usuario — Ampliar.** Ver y borrar ajustes, pistas y permisos guardados desde un mismo lugar.
62. **Permisos por función — Nueva.** Autorizar y revocar por separado apoyo familiar, documentos y usos de voz o datos; evitar un consentimiento único para todo.
63. **Modo de presentación con datos ocultos — Nueva.** Mostrar la demo o compartir pantalla sin exponer nombres, notas y documentos personales.
64. **Explicación sencilla de dónde van los datos — Nueva.** Aclarar qué queda en el dispositivo y qué se envía a un servicio cuando se usa una función.
65. **Medidas de autonomía elegidas y opcionales — Nueva.** Observar errores, acciones necesarias y esfuerzo declarado para mejorar la interfaz, sin convertirlos en indicadores de salud.
66. **Pruebas diseñadas con usuarios reales — Validación.** Comparar el mismo recorrido antes y después con personas que utilicen los modos priorizados; documentar límites y problemas, sin presentar una prueba de usabilidad como un ensayo clínico.

## L. Posibles líneas clínicas de más largo plazo

67. **Ejercicios seleccionados por fisioterapia — Clínica.** Reproducir un programa individual aprobado por el profesional, sin aumentar por sí solo repeticiones, esfuerzo o amplitud.
68. **Sesión con profesional a distancia — Clínica.** Compartir una actividad acordada y recibir indicaciones humanas, con datos y permisos adecuados.
69. **Entrenamiento cognitivo supervisado — Clínica.** Actividades seleccionadas y evaluadas por profesionales; no anunciar prevención o tratamiento de enfermedades sin evidencia.
70. **Práctica de comunicación con logopedia — Clínica.** Ejercicios y materiales adaptados por un profesional, sin emitir diagnósticos automáticos del habla.
71. **Escenarios terapéuticos supervisados — Clínica.** Simulaciones definidas por profesionales con controles de salida y evaluación; no un protocolo de exposición generado libremente por el modelo.
72. **Datos de sensores externos validados — Clínica.** Explorar integración con dispositivos adecuados y revisión profesional, sin atribuir precisión médica a señales del visor ni generar decisiones clínicas autónomas.

Para estas líneas habría que revisar el uso médico previsto y su validación, además del posible marco de producto sanitario. La denominación «acompañante» no decide por sí sola ese encaje. [Referencia de orientación MDCG sobre software](https://health.ec.europa.eu/latest-updates/update-mdcg-2019-11-rev1-qualification-and-classification-software-regulation-eu-2017745-and-2025-06-17_en?prefLang=es).

## Priorización ECC para el concurso

Estimaciones propias, de 1 a 5. Impacto se refiere a valor potencial para el recorrido de uso; confianza, a nuestra capacidad de demostrarlo bien con la base actual; esfuerzo, al desarrollo y validación necesarios. No son eficacia clínica, preferencias medidas del jurado ni presupuestos cerrados. Índice = impacto × confianza ÷ esfuerzo.

| Idea | Impacto | Confianza | Esfuerzo | Índice | Primera prueba observable |
|---|---:|---:|---:|---:|---|
| 1. Calibración guiada | 5 | 4 | 2 | 10 | Leer y seleccionar un control antes/después, con elección y Deshacer |
| 25. Pasos verificables | 4 | 4 | 2 | 8 | Confirmar un paso sin marcar toda la tarea como terminada |
| 32. Pausa tranquila | 4 | 4 | 2 | 8 | Pausar, reducir avisos y volver conservando pista y tiempo |
| 3. Selección configurable para temblor | 5 | 3 | 3 | 5 | Comparar errores y esfuerzo con el modo activado y desactivado |
| 37. Preparador de consultas | 4 | 3 | 3 | 4 | Revisar un resumen de datos de ejemplo sin diagnóstico añadido |
| 19. Tablero de comunicación | 5 | 3 | 4 | 3,75 | Expresar una petición sin hablar usando una entrada compatible |
| 53. Interfaz complementaria 2D | 5 | 3 | 4 | 3,75 | Continuar una tarea sin visor con navegación accesible probada |
| 43. Ayuda de configuración autorizada | 4 | 3 | 4 | 3 | Proponer un ajuste desde otro dispositivo y aceptarlo o rechazarlo |

## Selección que desarrollaría primero

1. **Calibración guiada**, aprovechando los cinco ajustes existentes y un recorrido breve que se pueda repetir.
2. **Pasos verificables**, extendiendo el primer paso actual y manteniendo la finalización bajo control del usuario.
3. **Selección configurable para temblor**, como apuesta de accesibilidad que exige pruebas con personas y hardware real.
4. Pulir el recorrido existente de **pausa y retorno**, y valorar la pausa tranquila sin crear otra función equivalente.

Después evaluaría comunicación sin habla y preparación de consultas con usuarios y profesionales apropiados. No intentaría desarrollar las 72 ideas para esta edición.

## Historia demostrable para la candidatura

Una persona explica qué le cuesta hoy; adapta la lectura y el alcance con decisiones concretas; elige una tarea pequeña; confirma un paso; necesita parar; guarda su pista; y vuelve otro día para continuar el mismo trabajo. Mostrar qué se implementó de verdad, los métodos de acceso probados y las limitaciones observadas sería parte de la presentación.

La evidencia pendiente de mayor valor es probar comodidad, métodos de entrada y rendimiento en el dispositivo físico elegido. Los criterios oficiales señalan rendimiento en hardware Quest y piden una demostración honesta de la experiencia. [Criterios oficiales](https://start-developer-competition-26.devpost.com/details/judging).
