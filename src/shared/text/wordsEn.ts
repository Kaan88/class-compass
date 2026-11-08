/**
 * Common English words for the student-text nonsense check (S13c, D-123). Written for Class Compass
 * (no third-party list; see docs/ASSETS.md): everyday words a primary-school child uses in goals,
 * reflections and evidence. Matching strips simple endings (-s, -es, -ed, -ing, -er, -est, -ly), so
 * only base forms are listed. Apostrophes are removed before matching ("don't" → "dont").
 */
const LIST = `
a about above across act action activity actor add after afternoon again against age ago agree air all almost alone along already also always am amazing an and
angry animal another answer ant any anyone anything apple april are arm around art as ask at attention august aunt autumn away awesome
baby back bad bag ball balloon banana band bank basketball bat bath be beach bean bear beautiful because bed bee been before begin behind believe
bell below best better between big bike bird birthday bit black blue board boat body book bored both bottle bottom box boy brain brave bread break
breakfast bright bring brother brown brush bubble build bus busy but butterfly buy by bye
cake call came camera can candy cap car card care careful carrot carry cat catch chair chalk change chapter chat check cheese chicken child children
chocolate choose circle city class classmate classroom clean clear clever climb clock close clothes cloud coat cold colour color come comic computer
cook cookie cool copy correct could count country cousin cow crayon cream create creative cry cup curious cut cute
dad daily dance dark date daughter day dear december decide deep desk dialogue dictionary did different difficult dinner dinosaur do doctor does dog
doll done door down draw drawing dream dress drink drive drum duck during
each ear early earth easy eat egg eight eighteen eleven else end english enjoy enough every everybody everyone everything example excellent excited
exercise eye
face fact fair fall family famous fan fantastic far farm fast father favourite favorite february feel feeling few field fifteen fifth fight film find
fine finish first fish five floor flower fly follow food foot football for forest forget fork four fourteen fox free friday friend friendly frog from
front fruit full fun funny future
game garden gave get giraffe girl give glad glass go goal goes going gold good goodbye got grade grammar grandfather grandma grandmother grandpa great green grew
ground group grow guess guitar
had hair half hand happy hard has hat have he head hear heart hello help her here hero hi high him his history hobby holiday home homework hop hope horse hot
hour house how hug hundred hungry
i ice idea if important in inside interesting into is island it its
january job join joke juice july jump june just
keep key kick kid kind king kitchen kite knee know
lake language large last late later laugh learn least leave left leg lemon lesson let letter library life light like line lion list listen listening little live
long look lose lot loud love lovely lunch
made make man many map march mark mat math maths may maybe me meal mean meet member memory message milk mind minute miss mistake model monday money monkey month moon more
morning most mother mountain mouse mouth move movie much mum music must my
name near need neat never new news next nice night nine nineteen no noise none nose not note notebook nothing november now number
ocean october of off often oh ok okay old on once one only open or orange other our out outside over own
page paint pair paper parent park part partner party pass past pen pencil people perfect person pet phone phonics photo piano picture piece pink pizza
place plan plane plant play player please poem point polite pool poor practice practise prepare present pretty prize problem project proud pull puppy purple push put puzzle
queen question quick quiet quiz
rabbit race rain rainbow read reader reading ready real really red remember repeat rest right river road robot rock room rule ruler run
sad safe said same sand saturday say school science score sea season second see sentence september set seven seventeen shape share she sheep ship shirt shoe shop short
should show shy sing sister sit six sixteen size skill sky sleep slow slowly small smart smile snack snake snow so some someone something sometimes son song soon
sorry sound soup space speak speaking special spell spelling spend sport spring square star start stay step stick still stop story street strong student study sugar
summer sun sunday super sure surprise swim
table take talk tall tea teach teacher team tell ten test than thank thanks that the their them then there these they thing think third thirteen thirty this those three
through throw thursday ticket tidy tiger time tired to today together told tomato tomorrow tonight too took top touch town toy train tree trip true try tuesday turn
turtle tv twelve twenty two
umbrella uncle under understand until up us use useful usually
very video village visit vocabulary voice
wait wake walk wall want warm was wash watch water way we wear weather wednesday week weekend welcome well went were what when where which white who whole why will
win wind window winter wish with without woman wonderful word work world worry would wow write writing wrong
yard year yellow yes yesterday yet you young your
zero zoo
im dont cant wont isnt ill ive youre lets thats whats didnt doesnt havent couldnt wasnt arent hes shes theyre were
alphabet bonus chart colouring cooperate effort fluently grandparent kindness neatly paragraph pronounce pronunciation
quietly reflection revise spoke spoken story tablet times word wordsearch worksheet clapping helpful listened answered
new also every better each speak spoke wrote written read heard sang ran swam drew began bought brought caught taught thought
knew felt kept left lost meant met paid sold sent slept stood understood won wore ate fell flew forgot gave grew hid held
memorise memorize irregular regular verb noun adjective adverb pronoun preposition tense past present future plural singular
phrase dialogue conversation presentation poster project quiz exam improve accurate fluent mistake error less fewer reduce
`;

export const EN_WORDS: ReadonlySet<string> = new Set(LIST.split(/\s+/u).filter(Boolean));
