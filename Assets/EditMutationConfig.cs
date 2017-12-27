using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using Assets.Src.Evolution;

public class EditMutationConfig : MonoBehaviour {
    public MutationConfig Config = new MutationConfig();

    public InputField Mutations;

    public InputField AllowedCharacters;

    public InputField MaxMutationLength;

    public InputField GenomeLength;

    public InputField GenerationSize;

    public InputField UseCompletelyRandomDefaultGenome;

    public InputField DefaultGenome;

    // Use this for initialization
    void Start () {
		
	}
	
	// Update is called once per frame
	void Update () {
		
	}
}
