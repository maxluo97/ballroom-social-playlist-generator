def main():
    global defaultBallroomStyles
    defaultBallroomStyles = {
        "RHYTHM": ["ACHA", "ARUM", "SWIN", "BOLE", "MAMB"],
        "LATIN": ["ICHA", "SAMB", "IRUM", "PASO", "JIVE"],
        "SMOOTH": ["AWLZ", "ATAN", "AFOX", "AVWZ"],
        "STANDARD": ["IWLZ", "ITAN", "IFOX", "IVWZ", "QSTP"]
        }


'''

styleDefine defines the number of styles, and the dances within each style.
    useDefStyle: Boolean that determines whether or not to use system defaults

By default, the four ballroom styles will collapse into two social styles ("LATIN" and "BALLROOM"), and will collapse similar dances together:

- American Cha-Cha and International Cha-Cha
- Swing and Jive
- Bolero and International Rumba
- Mambo and Salsa
- American Waltz and International Waltz
- American Tango and International Tango
- American Foxtrot and International Foxtrot
- American Viennese Waltz and International Viennese Waltz

- For best results, the dances in each style should be unique or distinctive.
'''
#TODO: 
def styleDefine(useDefStyles, ):
    if useDefStyles == 1:
        styles = {
            "LATIN": ["CHCHA", "AMRUM", "SWJIV", "BOLRU", "SLMAM", "DOBLE"],
            "BALLROOM": ["WALTZ", "TANGO", "FXTRT", "VWALZ", "QSTEP"]
        }
        return styles
    
    styleKeys = []
    while 1:
        newStyle = str(input("Enter the name of a style. Type -1 to exit.\nEntry: "))
        if newStyle == "-1":
            break
        styleKeys.append(newStyle)

    if len(styleKeys) == 0:
        raise Exception("No styles detected")
    for i in styleKeys:
        dances = []
        newDance = str(input("Enter the name of a dance in style: PLACEHOLDER"))
            
    return styles