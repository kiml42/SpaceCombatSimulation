using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using UnityEngine;

public class RegisterAsTarget : MonoBehaviour {
    public bool DeregisterOnDeactivate = true;

	void Start () {
        TargetRepository.RegisterTarget(new Target(transform));
	}

    public void Deactivate()
    {
        TargetRepository.DeregisterTarget(new Target(transform));
    }
}
