using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class RegisterAsTarget : MonoBehaviour {

	// Use this for initialization
	void Start () {
        TargetRepository.RegisterTarget(new Target(transform));
	}
}
