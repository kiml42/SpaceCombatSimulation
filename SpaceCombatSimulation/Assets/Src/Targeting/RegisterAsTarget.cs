using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using UnityEngine;

public class RegisterAsTarget : MonoBehaviour
{
    [Tooltip("Register as a target to be flown towards or shot at.")]
    public bool Shooting = true;

    [Tooltip("Register as a target to be flown towards but not shot at.")]
    public bool Navigation = false;

    // Use this for initialization
    void Start () {
        var target = new Target(transform);
        if (Navigation)
        {
            TargetRepository.RegisterNavigationTarget(target);
        }
        if (Shooting)
        {
            TargetRepository.RegisterTarget(target);
        }
	}

    public void Deactivate()
    {
        TargetRepository.DeregisterTarget(transform);
    }
}
