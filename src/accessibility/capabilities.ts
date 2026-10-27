/** User-facing capabilities distinguish shipped functionality from experiments that still need evidence. */
export type CapabilityState = 'available' | 'prototype' | 'hardware-required' | 'professional-validation';

export interface Capability {
  id: number;
  name: string;
  state: CapabilityState;
  detail: string;
}

/** Catalogue entries are not implementation claims: each state is reported explicitly. */
export const capabilities: readonly Capability[] = [
  {
    "id": 1,
    "name": "Calibración guiada de comodidad",
    "state": "prototype",
    "detail": "Preguntas breves y ejemplos de lectura y selección para elegir distancia, tamaño, lado y giro. La persona decide qué ajuste le resulta cómodo; la aplicación no mide dolor ni determina límites médicos."
  },
  {
    "id": 2,
    "name": "Zona de interacción elegida por la persona",
    "state": "prototype",
    "detail": "Concentrar los controles en el sector que pueda utilizar hoy, sin exigir buscar elementos girando todo el cuello."
  },
  {
    "id": 3,
    "name": "Selección configurable para temblor",
    "state": "prototype",
    "detail": "Estabilización de la puntería, margen de tolerancia y tiempo de confirmación ajustables; comparar errores y esfuerzo con personas que necesiten ese modo."
  },
  {
    "id": 4,
    "name": "Navegación con un único pulsador",
    "state": "hardware-required",
    "detail": "Recorrer opciones mediante barrido y seleccionar con una sola entrada, con velocidad regulable. Depende de integrar y probar un dispositivo de entrada compatible."
  },
  {
    "id": 5,
    "name": "Recorrido completo por voz con alternativas",
    "state": "prototype",
    "detail": "Ampliar órdenes, correcciones y confirmaciones para completar tareas sin gestos precisos; ofrecer siempre otra entrada si la voz falla."
  },
  {
    "id": 6,
    "name": "Cambiar de mano o de método en cualquier momento",
    "state": "prototype",
    "detail": "Pasar de mano derecha a izquierda, voz o selección sin manos sin rehacer el espacio ni perder trabajo."
  },
  {
    "id": 7,
    "name": "Lectura adaptable y fuentes completas",
    "state": "prototype",
    "detail": "Tipografía, tamaño, separación y anchura de línea configurables, con acentos y caracteres de los idiomas admitidos."
  },
  {
    "id": 8,
    "name": "Lupa de lectura estable",
    "state": "prototype",
    "detail": "Ampliar una tarjeta o documento en un panel fijo sin tener que acercar físicamente la cabeza."
  },
  {
    "id": 9,
    "name": "Paletas elegibles y estados que no dependan del color",
    "state": "prototype",
    "detail": "Combinar texto, forma y contraste para que un cambio no se comunique únicamente con rojo o verde."
  },
  {
    "id": 10,
    "name": "Lectura en voz alta de toda la interfaz",
    "state": "prototype",
    "detail": "Extender la lectura de planes a tareas, botones, pistas y errores; permitir repetir y regular la velocidad."
  },
  {
    "id": 11,
    "name": "Vista 2D semántica para lectores de pantalla",
    "state": "prototype",
    "detail": "Una alternativa con estructura y controles accesibles en navegador, probada con lectores reales; no basta con que el texto se dibuje en el panel 3D."
  },
  {
    "id": 12,
    "name": "Distribución en la zona visible elegida",
    "state": "prototype",
    "detail": "Permitir que la persona coloque el contenido en el área que prefiera ver, sin atribuir ni diagnosticar una alteración visual."
  },
  {
    "id": 13,
    "name": "Subtítulos personalizables del diálogo",
    "state": "prototype",
    "detail": "Texto visible del intercambio con el acompañante, con opciones de tamaño y permanencia."
  },
  {
    "id": 14,
    "name": "Avisos visuales y hápticos alternativos",
    "state": "hardware-required",
    "detail": "Ofrecer señales comprensibles para fin de bloque y errores; la vibración dependerá del controlador o dispositivo disponible."
  },
  {
    "id": 15,
    "name": "Volúmenes separados",
    "state": "prototype",
    "detail": "Ajustar voz, ambiente y avisos de forma independiente."
  },
  {
    "id": 16,
    "name": "Opción de audio mono",
    "state": "prototype",
    "detail": "No exigir distinguir izquierda y derecha por el sonido para entender la aplicación."
  },
  {
    "id": 17,
    "name": "Posición de subtítulos elegible",
    "state": "prototype",
    "detail": "Evitar que tapen la tarea o los controles, con una posición estable acordada con el usuario."
  },
  {
    "id": 18,
    "name": "Conversación escrita con el agente",
    "state": "prototype",
    "detail": "Poder pedir ayuda y corregir propuestas escribiendo, sin necesitar hablar ni oír."
  },
  {
    "id": 19,
    "name": "Tablero de comunicación aumentativa y alternativa",
    "state": "prototype",
    "detail": "Frases elegidas por la persona, como «necesito una pausa» o «quiero ayuda», que pueda seleccionar y reproducir con voz."
  },
  {
    "id": 20,
    "name": "Respuestas mediante sí, no y opciones claras",
    "state": "prototype",
    "detail": "Permitir expresar elecciones sin una frase larga; distinguir responder a una pregunta de autorizar un cambio."
  },
  {
    "id": 21,
    "name": "Compositor de mensajes con voz",
    "state": "prototype",
    "detail": "Escribir o seleccionar palabras y reproducir el mensaje, con edición y confirmación del contenido."
  },
  {
    "id": 22,
    "name": "Dictado al ritmo de la persona",
    "state": "prototype",
    "detail": "Ajustar tolerancia a pausas y duración de escucha, con un control claro para terminar manualmente."
  },
  {
    "id": 23,
    "name": "Diccionario personal de órdenes",
    "state": "prototype",
    "detail": "Alias y correcciones escogidos por el usuario para sus expresiones habituales, sin inferir lo que pretendía decir."
  },
  {
    "id": 24,
    "name": "Idiomas y traducción con original visible",
    "state": "prototype",
    "detail": "Facilitar comunicación entre usuario y acompañante conservando el texto original y señalando incertidumbre de la traducción."
  },
  {
    "id": 25,
    "name": "Una tarea convertida en pasos verificables",
    "state": "prototype",
    "detail": "Extender Start small a una lista breve; la persona confirma cada paso y puede corregirlo, saltarlo o deshacerlo."
  },
  {
    "id": 26,
    "name": "Una sola acción principal en pantalla",
    "state": "prototype",
    "detail": "Mostrar el paso actual y guardar el resto del contenido detrás de una opción predecible."
  },
  {
    "id": 27,
    "name": "Rutinas con imágenes y texto",
    "state": "prototype",
    "detail": "Secuencias elegidas por la persona para gestiones diarias, manteniendo un lenguaje adulto."
  },
  {
    "id": 28,
    "name": "Varios puntos de retorno",
    "state": "prototype",
    "detail": "Extender el marcador actual a distintos contextos, por ejemplo trabajo, estudio y gestiones, siempre con guardado explícito."
  },
  {
    "id": 29,
    "name": "Explicaciones en lectura fácil",
    "state": "prototype",
    "detail": "Botones como «explícamelo más sencillo» o «dime solo el siguiente paso», preservando los datos importantes."
  },
  {
    "id": 30,
    "name": "Ayuda «me he perdido»",
    "state": "prototype",
    "detail": "Ofrecer tres salidas claras: recordar la tarea actual, repetir el paso o volver al inicio."
  },
  {
    "id": 31,
    "name": "Tiempo y esfuerzo disponibles decididos por la persona",
    "state": "prototype",
    "detail": "Afinar las sesiones actuales para que el usuario pueda escoger una participación breve y detenerla en cualquier momento, sin progresión automática."
  },
  {
    "id": 32,
    "name": "Pausa tranquila en una acción",
    "state": "prototype",
    "detail": "Unir pausa del reloj, reducción voluntaria de avisos y conservación del siguiente paso, con una salida fácil."
  },
  {
    "id": 33,
    "name": "Registro subjetivo y opcional de energía",
    "state": "prototype",
    "detail": "Anotar cómo se siente la persona si lo desea, sin deducir enfermedad, emoción o capacidad a partir de sus movimientos."
  },
  {
    "id": 34,
    "name": "Replanificar un día difícil",
    "state": "prototype",
    "detail": "Posponer lo que el usuario elija sin penalizar descansos ni modificar citas por su cuenta."
  },
  {
    "id": 35,
    "name": "Alternar visor y pantalla convencional",
    "state": "prototype",
    "detail": "Continuar la tarea desde otro formato cuando la persona prefiera dejar de usar el visor."
  },
  {
    "id": 36,
    "name": "Configuraciones por contexto",
    "state": "prototype",
    "detail": "Guardar ajustes para una silla, una postura reclinada o distintos espacios; evitar etiquetas diagnósticas automáticas."
  },
  {
    "id": 37,
    "name": "Preparador de consultas",
    "state": "prototype",
    "detail": "Ayudar a organizar preguntas, observaciones propias y documentos que la persona quiere llevar; revisar el resultado antes de exportarlo."
  },
  {
    "id": 38,
    "name": "Cronología personal de observaciones",
    "state": "prototype",
    "detail": "Registrar lo que el usuario comunica y cuándo, sin convertirlo en un diagnóstico ni un nivel de urgencia automático."
  },
  {
    "id": 39,
    "name": "Agenda de citas y trámites accesible",
    "state": "prototype",
    "detail": "Recordar fecha, lugar, documentación y preguntas pendientes, con los mismos métodos de acceso que el espacio de trabajo."
  },
  {
    "id": 40,
    "name": "Lectura fácil de instrucciones administrativas",
    "state": "prototype",
    "detail": "Explicar trámites, cartas de citas y formularios manteniendo el original y permitiendo comprobar cada dato."
  },
  {
    "id": 41,
    "name": "Recordatorios de un plan indicado por profesionales",
    "state": "prototype",
    "detail": "Reproducir un plan revisado, sin inventar pautas, cambiar dosis ni recomendar compensaciones de una toma olvidada."
  },
  {
    "id": 42,
    "name": "Resumen para llevar a un profesional",
    "state": "prototype",
    "detail": "Documento breve que el usuario puede editar y aprobar; compartirlo sería una acción separada y explícita."
  },
  {
    "id": 43,
    "name": "Ayuda de configuración desde un móvil",
    "state": "prototype",
    "detail": "Una persona autorizada propone ajustes y el usuario conserva la aprobación final."
  },
  {
    "id": 44,
    "name": "Compañía humana voluntaria",
    "state": "prototype",
    "detail": "Presencia compartida para trabajar o hacer una gestión, con controles de entrada, salida y privacidad."
  },
  {
    "id": 45,
    "name": "Compartir solamente tareas escogidas",
    "state": "prototype",
    "detail": "Acceso limitado a lo autorizado, sin entregar todo el espacio ni las notas personales."
  },
  {
    "id": 46,
    "name": "Pedir ayuda cotidiana con un mensaje preparado",
    "state": "prototype",
    "detail": "Elegir contacto y revisar el mensaje antes de enviarlo; no se presentaría como servicio de emergencias."
  },
  {
    "id": 47,
    "name": "Tarjeta de preferencias de acceso",
    "state": "prototype",
    "detail": "Compartir voluntariamente cómo prefiere interactuar la persona, sin exigir revelar su diagnóstico."
  },
  {
    "id": 48,
    "name": "Guía de apoyo personalizada",
    "state": "prototype",
    "detail": "Instrucciones que el usuario decide mostrar a quien le ayude: qué puede configurar y qué prefiere controlar por sí mismo."
  },
  {
    "id": 49,
    "name": "Puesto adaptado sobre una superficie elegida",
    "state": "prototype",
    "detail": "Extender Fit room con ajuste manual y confirmación de la colocación; no confundir reconocer un plano con garantizar seguridad física."
  },
  {
    "id": 50,
    "name": "Acercar una tarea concreta",
    "state": "prototype",
    "detail": "Traer el panel necesario a una zona de uso elegida, conservando el resto del espacio cuando sea posible."
  },
  {
    "id": 51,
    "name": "Recuperación clara de la interfaz",
    "state": "prototype",
    "detail": "Un acceso consistente para recuperar menús si se pierde la referencia, sin pedir a la persona que se levante o busque girándose."
  },
  {
    "id": 52,
    "name": "Control ocular en dispositivos compatibles",
    "state": "hardware-required",
    "detail": "Probar seguimiento de ojos cuando el visor y la aplicación lo permitan, con alternativa por otro método de entrada."
  },
  {
    "id": 53,
    "name": "Interfaz complementaria 2D",
    "state": "prototype",
    "detail": "Versión accesible en móvil u ordenador para quien no pueda o no quiera usar un visor, con transferencia de tarea controlada."
  },
  {
    "id": 54,
    "name": "Integración de entradas alternativas",
    "state": "hardware-required",
    "detail": "Evaluar pulsador, teclado, pedal u otros mandos compatibles, con funciones asignables y pruebas en cada combinación de hardware."
  },
  {
    "id": 55,
    "name": "Guía experta del uso de SpatialDesk",
    "state": "prototype",
    "detail": "Responder con instrucciones comprobadas de la aplicación y reconocer funciones que no están disponibles."
  },
  {
    "id": 56,
    "name": "Información general de salud con fuentes revisadas",
    "state": "prototype",
    "detail": "Contenido acotado, procedencia y fecha visibles, con mecanismos para decir «no lo sé» y sin diagnosticar a la persona."
  },
  {
    "id": 57,
    "name": "Aclarar antes de adaptar",
    "state": "prototype",
    "detail": "Preguntas breves que distingan dificultades de lectura, alcance o comprensión y propongan un solo cambio comprobable."
  },
  {
    "id": 58,
    "name": "Explicar la consecuencia antes de aplicar",
    "state": "prototype",
    "detail": "Mostrar qué cambiará y permitir comparar, aceptar o deshacer, evitando afirmar alivio de síntomas."
  },
  {
    "id": 59,
    "name": "Historial comprensible de decisiones",
    "state": "prototype",
    "detail": "Distinguir lo propuesto, descartado, aplicado y deshecho; cualquier persistencia adicional requeriría elección explícita."
  },
  {
    "id": 60,
    "name": "Ayuda local cuando no hay conexión",
    "state": "prototype",
    "detail": "Instrucciones y operaciones básicas verificadas, identificadas como locales y sin simular una respuesta de Nova."
  },
  {
    "id": 61,
    "name": "Centro de memoria controlado por el usuario",
    "state": "prototype",
    "detail": "Ver y borrar ajustes, pistas y permisos guardados desde un mismo lugar."
  },
  {
    "id": 62,
    "name": "Permisos por función",
    "state": "prototype",
    "detail": "Autorizar y revocar por separado apoyo familiar, documentos y usos de voz o datos; evitar un consentimiento único para todo."
  },
  {
    "id": 63,
    "name": "Modo de presentación con datos ocultos",
    "state": "prototype",
    "detail": "Mostrar la demo o compartir pantalla sin exponer nombres, notas y documentos personales."
  },
  {
    "id": 64,
    "name": "Explicación sencilla de dónde van los datos",
    "state": "prototype",
    "detail": "Aclarar qué queda en el dispositivo y qué se envía a un servicio cuando se usa una función."
  },
  {
    "id": 65,
    "name": "Medidas de autonomía elegidas y opcionales",
    "state": "prototype",
    "detail": "Observar errores, acciones necesarias y esfuerzo declarado para mejorar la interfaz, sin convertirlos en indicadores de salud."
  },
  {
    "id": 66,
    "name": "Pruebas diseñadas con usuarios reales",
    "state": "prototype",
    "detail": "Comparar el mismo recorrido antes y después con personas que utilicen los modos priorizados; documentar límites y problemas, sin presentar una prueba de usabilidad como un ensayo clínico."
  },
  {
    "id": 67,
    "name": "Ejercicios seleccionados por fisioterapia",
    "state": "professional-validation",
    "detail": "Reproducir un programa individual aprobado por el profesional, sin aumentar por sí solo repeticiones, esfuerzo o amplitud."
  },
  {
    "id": 68,
    "name": "Sesión con profesional a distancia",
    "state": "professional-validation",
    "detail": "Compartir una actividad acordada y recibir indicaciones humanas, con datos y permisos adecuados."
  },
  {
    "id": 69,
    "name": "Entrenamiento cognitivo supervisado",
    "state": "professional-validation",
    "detail": "Actividades seleccionadas y evaluadas por profesionales; no anunciar prevención o tratamiento de enfermedades sin evidencia."
  },
  {
    "id": 70,
    "name": "Práctica de comunicación con logopedia",
    "state": "professional-validation",
    "detail": "Ejercicios y materiales adaptados por un profesional, sin emitir diagnósticos automáticos del habla."
  },
  {
    "id": 71,
    "name": "Escenarios terapéuticos supervisados",
    "state": "professional-validation",
    "detail": "Simulaciones definidas por profesionales con controles de salida y evaluación; no un protocolo de exposición generado libremente por el modelo."
  },
  {
    "id": 72,
    "name": "Datos de sensores externos validados",
    "state": "professional-validation",
    "detail": "Explorar integración con dispositivos adecuados y revisión profesional, sin atribuir precisión médica a señales del visor ni generar decisiones clínicas autónomas."
  }
];
